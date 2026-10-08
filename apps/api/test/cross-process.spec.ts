import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { ChangeSource, ServerEvent } from '@b2b-system/realtime';
import type {
  ClientToServerEvents,
  ResourceChanged,
  ServerToClientEvents,
  SessionRevoked,
} from '@b2b-system/realtime';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { FeatureFlagService } from '@/core/feature-flags';
import { featureFlagOverrides } from '@/db/platform/schema';
import { users } from '@/db/schema';
import { DEFAULT_REALTIME_LIMITS, REALTIME_LIMITS } from '@/modules/realtime/realtime.constants';
import { RealtimeGateway } from '@/modules/realtime/realtime.gateway';

import type { PlatformTestDatabase, TestDatabase } from './db';
import { createPlatformTestDatabase, createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { testTenantContext } from './tenant';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
const SUPER_ADMIN_EMAIL = 'cross-root@example.com';
const EVENT_TIMEOUT_MS = 3_000;
/** 公開設定（未登入可讀）：B 讀的是它自己的設定快取。 */
const REGISTRATION = 'auth.registrationEnabled';

/** 一個「程序」：同一份 AppModule 建出來的另一個 Nest app，有自己的快取、廣播的 instanceId 與 Socket.io。 */
interface Process {
  app: INestApplication;
  http: App;
  url: string;
}

let a: Process;
let b: Process;
let db: TestDatabase;
let platformDb: PlatformTestDatabase;
let closeDb: () => Promise<void>;
let jwt: JwtService;
let tenantId: string;
let rootToken: string;
const opened: ClientSocket[] = [];

async function startProcess(): Promise<Process> {
  const { AppModule } = await import('@/app.module');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(REALTIME_LIMITS)
    .useValue({ ...DEFAULT_REALTIME_LIMITS, handshakesPerIp: 10_000 })
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  const http = await listenOnLoopback(app);
  const url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  return { app, http, url };
}

/** 直接簽 access token：兩個程序共用 `JWT_SECRET`，同一把 token 在兩邊都有效。 */
async function tokenFor(userId: string, ver = 0): Promise<string> {
  return jwt.signAsync(
    { sub: userId, ver, jti: randomUUID(), tid: tenantId },
    { secret: JWT_SECRET, expiresIn: 300 },
  );
}

async function createMember(email: string): Promise<{ id: string; version: number }> {
  const [user] = await db
    .insert(users)
    .values({ email, displayName: email, status: 'active' })
    .returning();
  return { id: user!.id, version: user!.version };
}

async function connect(process: Process, token: string): Promise<ClientSocket> {
  const socket: ClientSocket = io(process.url, {
    path: '/socket.io',
    transports: ['websocket'],
    auth: { token },
    reconnection: false,
    forceNew: true,
  });
  opened.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  // 伺服器端加入 room（要先解析權限）之後才開始測
  await vi.waitFor(() => {
    const server = process.app.get(RealtimeGateway).server!.sockets.sockets.get(socket.id ?? '');
    if (!server || server.rooms.size <= 1) throw new Error('伺服器端還沒加入 room');
  });
  return socket;
}

function waitFor<T>(
  socket: ClientSocket,
  event: string,
  accept: (payload: T) => boolean = () => true,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等不到 ${event}`)), EVENT_TIMEOUT_MS);
    const listener = (payload: T) => {
      if (!accept(payload)) return;
      clearTimeout(timer);
      (socket as unknown as Socket).off(event, listener);
      resolve(payload);
    };
    (socket as unknown as Socket).on(event, listener);
  });
}

function flagsOf(process: Process): FeatureFlagService {
  return process.app.get(FeatureFlagService);
}

async function publicSetting(process: Process, key: string): Promise<unknown> {
  const response = await request(process.http).get('/system/settings/public').expect(200);
  return (response.body as { data: { values: Record<string, unknown> } }).data.values[key];
}

describe('兩個程序之間的一致性（docs/architecture/06-external-api.md §9.2 D16、D18）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN_EMAIL;
    process.env.SUPER_ADMIN_PASSWORD = 'Quiet-Harbor-Lantern-26';

    const created = createTestDatabase();
    const platform = createPlatformTestDatabase();
    db = created.db;
    platformDb = platform.db;
    closeDb = async () => {
      await created.client.end();
      await platform.client.end();
    };
    await truncateAll(db);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);

    a = await startProcess();
    b = await startProcess();
    jwt = a.app.get(JwtService);
    tenantId = (await testTenantContext(a.app)).id;
    const [root] = await db.select().from(users).where(eq(users.email, SUPER_ADMIN_EMAIL));
    rootToken = await tokenFor(root!.id);
  });

  afterAll(async () => {
    for (const socket of opened.splice(0)) socket.disconnect();
    await a?.app.close();
    await b?.app.close();
    await closeDb?.();
  });

  it('在 A 停用使用者：B 不等使用者快取的 TTL（30 秒）就拒絕他的 token', async () => {
    const member = await createMember('cross-disabled@example.com');
    const token = await tokenFor(member.id);
    const me = () => request(b.http).get('/auth/profile').set('authorization', `Bearer ${token}`);
    // B 先把這個人放進快取
    expect((await me()).status).toBe(200);

    await request(a.http)
      .patch(`/users/${member.id}`)
      .set('authorization', `Bearer ${rootToken}`)
      .send({ status: 'inactive', version: member.version })
      .expect(200);

    await vi.waitFor(
      async () =>
        expect((await me()).body).toMatchObject({ error: { code: 'AUTH_ACCOUNT_DISABLED' } }),
      { timeout: 2_000 },
    );
  });

  it('在 A 停用使用者：他連在 B 的即時連線收到 session.revoked 並被斷線', async () => {
    const member = await createMember('cross-socket@example.com');
    const socket = await connect(b, await tokenFor(member.id));
    const revoked = waitFor<SessionRevoked>(socket, ServerEvent.SESSION_REVOKED);

    await request(a.http)
      .patch(`/users/${member.id}`)
      .set('authorization', `Bearer ${rootToken}`)
      .send({ status: 'inactive', version: member.version })
      .expect(200);

    expect((await revoked).reason).toBe('AUTH_ACCOUNT_DISABLED');
  });

  it('在 A 建立角色：連在 B 的管理者收到 resource.changed', async () => {
    const socket = await connect(b, rootToken);
    const changed = waitFor<ResourceChanged>(socket, ServerEvent.RESOURCE_CHANGED, (payload) =>
      payload.changes.some((change) => change.resource === ChangeSource.ROLE),
    );

    await request(a.http)
      .post('/roles')
      .set('authorization', `Bearer ${rootToken}`)
      .send({ name: '跨程序' })
      .expect(201);

    expect((await changed).changes).toContainEqual(
      expect.objectContaining({ resource: ChangeSource.ROLE }),
    );
  });

  it('在 A 修改系統設定：B 不等設定快取的 TTL 就讀到新值', async () => {
    const before = await publicSetting(b, REGISTRATION);

    await request(a.http)
      .patch('/system/settings')
      .set('authorization', `Bearer ${rootToken}`)
      .send({ values: { [REGISTRATION]: !before } })
      .expect(200);

    await vi.waitFor(async () => expect(await publicSetting(b, REGISTRATION)).toBe(!before), {
      timeout: 2_000,
    });
  });

  it('在 A 改 feature flag 的全平台覆寫：B 不等 TENANT_CACHE_TTL 就讀到新值', async () => {
    // 目錄裡沒有的 key 也會載入全平台層（isEnabled 才看目錄），不必為測試加一個 flag
    const key = 'crossProcess.test';
    expect(flagsOf(b).globalStateOf(key)).toBeUndefined();

    await platformDb.insert(featureFlagOverrides).values({ key, state: 'on' });
    try {
      await flagsOf(a).changed();

      await vi.waitFor(() => expect(flagsOf(b).globalStateOf(key)).toBe('on'), {
        timeout: 2_000,
      });
    } finally {
      await platformDb.delete(featureFlagOverrides).where(eq(featureFlagOverrides.key, key));
    }
  });
});
