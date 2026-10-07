import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { ChangeSource, ServerEvent } from '@b2b-system/realtime';
import type {
  ClientToServerEvents,
  ResourceChanged,
  ServerToClientEvents,
} from '@b2b-system/realtime';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Env } from '@/core/config';
import { DomainEventBus } from '@/core/events';
import { ObjectStorage } from '@/core/storage';
import { platformAdmins, platformNotifications } from '@/db/platform/schema';
import { users } from '@/db/schema';
import { upsertPlatformAdmin } from '@/db/seeds/platform-admin';
import { PlatformNotificationType } from '@/modules/platform-notification/platform-notification.constants';
import { PlatformNotificationService } from '@/modules/platform-notification/platform-notification.service';
import { DEFAULT_REALTIME_LIMITS, REALTIME_LIMITS } from '@/modules/realtime/realtime.constants';
import { RealtimeGateway } from '@/modules/realtime/realtime.gateway';

import type { PlatformTestDatabase, TestDatabase } from './db';
import { createPlatformTestDatabase, createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { InMemoryObjectStorage } from './in-memory-object-storage';
import { testTenantContext } from './tenant';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** apps/platform 的網域（`PLATFORM_APP_URL` 的預設值）與測試租戶的網域。 */
const AUTH_HOST = 'localhost:5175';
const HOME_HOST = '127.0.0.1';
const PASSWORD = 'PlatformPassword!2026';
const EVENT_TIMEOUT_MS = 3_000;

let app: INestApplication;
let http: App;
let url: string;
let platformDb: PlatformTestDatabase;
let home: TestDatabase;
let bus: DomainEventBus;
const closers: Array<() => Promise<void>> = [];
const opened: ClientSocket[] = [];

function dataOf<T>(response: { body: unknown }): T {
  return (response.body as { data: T }).data;
}

function itemsOf<T>(response: { body: unknown }): T[] {
  return dataOf<{ items: T[] }>(response).items;
}

function errorCodeOf(response: { body: unknown }): string | undefined {
  return (response.body as { error?: { code?: string } }).error?.code;
}

async function adminIdOf(email: string): Promise<string> {
  const [admin] = await platformDb
    .select()
    .from(platformAdmins)
    .where(eq(platformAdmins.email, email));
  if (!admin) throw new Error(`找不到平台管理者 ${email}`);
  return admin.id;
}

async function signPlatformToken(email: string): Promise<string> {
  const [admin] = await platformDb
    .select()
    .from(platformAdmins)
    .where(eq(platformAdmins.email, email));
  if (!admin) throw new Error(`找不到平台管理者 ${email}`);
  const secret = app.get(ConfigService<Env, true>).get('JWT_SECRET', { infer: true });
  return app
    .get(JwtService)
    .signAsync(
      { sub: admin.id, ver: admin.tokenVersion, jti: randomUUID(), realm: 'platform' },
      { secret, expiresIn: 300 },
    );
}

function as(token: string, method: 'get' | 'post' | 'patch' | 'delete', path: string) {
  return request(http)[method](path).set('Host', AUTH_HOST).set('authorization', `Bearer ${token}`);
}

function openSocket(token: string, host: string): ClientSocket {
  const socket: ClientSocket = io(url, {
    path: '/socket.io',
    transports: ['websocket'],
    auth: { token },
    extraHeaders: { host },
    reconnection: false,
    forceNew: true,
  });
  opened.push(socket);
  return socket;
}

async function connect(token: string, host = AUTH_HOST): Promise<ClientSocket> {
  const socket = openSocket(token, host);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  // 客戶端的 connect 早於伺服器端加入 room：等伺服器端的連線有了 room 再開始測
  await vi.waitFor(() => {
    const server = app.get(RealtimeGateway).server!.sockets.sockets.get(socket.id ?? '');
    if (!server || server.rooms.size <= 1) throw new Error('伺服器端還沒加入 room');
  });
  return socket;
}

async function connectError(token: string, host: string): Promise<string | undefined> {
  const socket = openSocket(token, host);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => reject(new Error('預期連線被拒，但連上了')));
    socket.once('connect_error', (error: Error & { data?: { code?: string } }) =>
      resolve(error.data?.code),
    );
  });
}

function nextChange(socket: ClientSocket, resource: string): Promise<ResourceChanged> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等不到 ${resource}`)), EVENT_TIMEOUT_MS);
    const onChange = (payload: ResourceChanged) => {
      if (!payload.changes.some((change) => change.resource === resource)) return;
      clearTimeout(timer);
      socket.off(ServerEvent.RESOURCE_CHANGED, onChange);
      resolve(payload);
    };
    socket.on(ServerEvent.RESOURCE_CHANGED, onChange);
  });
}

describe('平台管理者的即時推播與站內通知（docs/architecture/backend/08-realtime.md §3.6、15-notification.md §6.2）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = 'pr-tenant-root@example.com';
    process.env.SUPER_ADMIN_PASSWORD = 'Quiet-Harbor-Lantern-26';

    const platform = createPlatformTestDatabase();
    platformDb = platform.db;
    closers.push(async () => platform.client.end());
    for (const role of ['super-admin', 'operator', 'auditor'] as const) {
      await upsertPlatformAdmin(platformDb, {
        email: `pr-${role}@example.com`,
        displayName: role,
        password: PASSWORD,
        role,
      });
    }

    const tenantDb = createTestDatabase();
    home = tenantDb.db;
    closers.push(async () => tenantDb.client.end());
    await truncateAll(home);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(home as never);

    const { AppModule } = await import('@/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REALTIME_LIMITS)
      .useValue({ ...DEFAULT_REALTIME_LIMITS, handshakesPerIp: 10_000 })
      .overrideProvider(ObjectStorage)
      .useValue(new InMemoryObjectStorage())
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    http = await listenOnLoopback(app);
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    bus = app.get(DomainEventBus);
    await platformDb.delete(platformNotifications);
  });

  afterEach(() => {
    for (const socket of opened.splice(0)) socket.disconnect();
  });

  afterAll(async () => {
    await app.close();
    for (const close of closers) await close();
  });

  it('apps/platform 的網域只接受平台管理者的 token；租戶網域不接受平台的 token', async () => {
    const root = await signPlatformToken('pr-super-admin@example.com');
    await connect(root);
    expect(await connectError(root, HOME_HOST)).toBe('AUTH_TOKEN_INVALID');

    const tenantId = (await testTenantContext(app)).id;
    const [user] = await home
      .select()
      .from(users)
      .where(eq(users.email, 'pr-tenant-root@example.com'));
    const tenantToken = await app
      .get(JwtService)
      .signAsync(
        { sub: user!.id, ver: 0, jti: randomUUID(), tid: tenantId },
        { secret: process.env.JWT_SECRET!, expiresIn: 300 },
      );
    expect(await connectError(tenantToken, AUTH_HOST)).toBe('AUTH_TOKEN_INVALID');
  });

  it('平台的寫入推給所有平台管理者的連線（租戶改名 → platformTenant）', async () => {
    const root = await signPlatformToken('pr-super-admin@example.com');
    const auditor = await connect(await signPlatformToken('pr-auditor@example.com'));
    const tenantId = (await testTenantContext(app)).id;
    const changed = nextChange(auditor, ChangeSource.PLATFORM_TENANT);
    await as(root, 'patch', `/platform/tenants/${tenantId}`)
      .send({ name: '改名的租戶' })
      .expect(200);
    expect((await changed).changes).toContainEqual(
      expect.objectContaining({ resource: ChangeSource.PLATFORM_TENANT, id: tenantId }),
    );
  });

  it('通知能建立租戶的人：只有收件人收到推播；列表、未讀數、標已讀', async () => {
    const operatorSocket = await connect(await signPlatformToken('pr-operator@example.com'));
    const pushed = nextChange(operatorSocket, ChangeSource.PLATFORM_NOTIFICATION);
    await app.get(PlatformNotificationService).notifyHolders('tenant:create', {
      type: PlatformNotificationType.TENANT_PROVISIONED,
      params: { code: 'acme', name: 'Acme' },
      link: { route: 'tenant.detail', params: { id: 'x' } },
    });
    await pushed;
    await bus.drain();

    const operator = await signPlatformToken('pr-operator@example.com');
    const auditor = await signPlatformToken('pr-auditor@example.com');
    expect(
      dataOf<{ count: number }>(
        await as(operator, 'get', '/platform/notifications/unread-count').expect(200),
      ).count,
    ).toBe(1);
    // auditor 沒有 tenant:create：不是收件人
    expect(
      dataOf<{ count: number }>(
        await as(auditor, 'get', '/platform/notifications/unread-count').expect(200),
      ).count,
    ).toBe(0);

    const list = itemsOf<{ id: string; type: string; params: { code: string } }>(
      await as(operator, 'get', '/platform/notifications?unread=true').expect(200),
    );
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: 'tenant.provisioned', params: { code: 'acme' } });

    // 別人的通知：不透露存在
    const others = await as(auditor, 'post', `/platform/notifications/${list[0]!.id}/read`).expect(
      404,
    );
    expect(errorCodeOf(others)).toBe('NOTIFICATION_NOT_FOUND');
    await as(operator, 'post', `/platform/notifications/${list[0]!.id}/read`).expect(200);
    // 已讀過的再標一次不算錯
    await as(operator, 'post', `/platform/notifications/${list[0]!.id}/read`).expect(200);
    expect(
      itemsOf(await as(operator, 'get', '/platform/notifications?unread=true').expect(200)),
    ).toHaveLength(0);

    // 刪除：別人的不透露存在；自己的刪掉後列表不含它
    expect(
      errorCodeOf(
        await as(auditor, 'delete', `/platform/notifications/${list[0]!.id}`).expect(404),
      ),
    ).toBe('NOTIFICATION_NOT_FOUND');
    await as(operator, 'delete', `/platform/notifications/${list[0]!.id}`).expect(204);
    expect(
      itemsOf<{ id: string }>(await as(operator, 'get', '/platform/notifications').expect(200)).map(
        (item) => item.id,
      ),
    ).not.toContain(list[0]!.id);
  });

  it('換角色：通知本人；停用：推 session.revoked 並斷線', async () => {
    const root = await signPlatformToken('pr-super-admin@example.com');
    const auditorId = await adminIdOf('pr-auditor@example.com');
    const auditorSocket = await connect(await signPlatformToken('pr-auditor@example.com'));

    const notified = nextChange(auditorSocket, ChangeSource.PLATFORM_NOTIFICATION);
    await as(root, 'patch', `/platform/admins/${auditorId}`).send({ role: 'operator' }).expect(200);
    await notified;
    const auditor = await signPlatformToken('pr-auditor@example.com');
    const [latest] = itemsOf<{ type: string; params: Record<string, string> }>(
      await as(auditor, 'get', '/platform/notifications').expect(200),
    );
    expect(latest).toMatchObject({
      type: 'platformAdmin.roleChanged',
      params: { from: 'auditor', to: 'operator' },
    });
    await as(auditor, 'post', '/platform/notifications/read-all').expect(200);

    const revoked = new Promise<{ reason: string }>((resolve) =>
      auditorSocket.once(ServerEvent.SESSION_REVOKED, resolve),
    );
    const disconnected = new Promise<void>((resolve) =>
      auditorSocket.once('disconnect', () => resolve()),
    );
    await as(root, 'patch', `/platform/admins/${auditorId}`)
      .send({ status: 'inactive' })
      .expect(200);
    expect((await revoked).reason).toBe('AUTH_ACCOUNT_DISABLED');
    await disconnected;
  });

  it('保留清理：已讀超過 30 天、或超過 180 天的通知刪掉', async () => {
    const operatorId = await adminIdOf('pr-operator@example.com');
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    await platformDb.delete(platformNotifications);
    await platformDb.insert(platformNotifications).values([
      // 已讀 31 天：刪
      { recipientId: operatorId, type: 't', params: {}, readAt: new Date(now - 31 * day) },
      // 已讀 1 天：留
      { recipientId: operatorId, type: 't', params: {}, readAt: new Date(now - day) },
      // 未讀但 181 天：刪
      { recipientId: operatorId, type: 't', params: {}, createdAt: new Date(now - 181 * day) },
      // 未讀 10 天：留
      { recipientId: operatorId, type: 't', params: {}, createdAt: new Date(now - 10 * day) },
    ]);
    expect(await app.get(PlatformNotificationService).cleanup(new Date(now))).toEqual({
      deleted: 2,
    });
    expect(await platformDb.select().from(platformNotifications)).toHaveLength(2);
  });
});
