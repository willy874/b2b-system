import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { CLIENT_ID_HEADER, ClientEvent, ServerEvent } from '@b2b-system/realtime';
import type {
  ChannelEnvelopeWire,
  ClientToServerEvents,
  ResourceChanged,
  ServerToClientEvents,
  SessionRenewResult,
} from '@b2b-system/realtime';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';

import { DomainEvent, DomainEventBus } from '@/core/events';
import { roles, userRoles, users } from '@/db/schema';
import { AuditService } from '@/modules/audit-log/audit.service';
import { DEFAULT_REALTIME_LIMITS, REALTIME_LIMITS } from '@/modules/realtime/realtime.constants';
import { RealtimeGateway } from '@/modules/realtime/realtime.gateway';
import { userRoom } from '@/modules/realtime/realtime.rooms';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';
import { assignRoles, createWorkspace, workspacePath } from './workspace';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
const SUPER_ADMIN_EMAIL = 'realtime-root@example.com';
const CONNECTIONS_PER_USER = 4;
const EVENT_TIMEOUT_MS = 3_000;

let app: INestApplication;
let http: App;
let url: string;
let db: TestDatabase;
let closeDb: () => Promise<void>;
let bus: DomainEventBus;
let jwt: JwtService;

const opened: ClientSocket[] = [];

// ── 工具 ─────────────────────────────────────────────────────

async function createUser(email: string, roleIds: string[] = []): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ email, displayName: email, status: 'active' })
    .returning();
  for (const roleId of roleIds) await db.insert(userRoles).values({ userId: user!.id, roleId });
  return user!.id;
}

async function roleIdOf(slug: string): Promise<string> {
  const [role] = await db.select().from(roles).where(eq(roles.slug, slug));
  return role!.id;
}

/** 直接簽 access token：登入端點有速率限制，而且這裡要測的是 socket 不是登入。 */
async function tokenFor(
  userId: string,
  options: { ver?: number; expiresIn?: number; exp?: number } = {},
): Promise<string> {
  const payload: Record<string, unknown> = {
    sub: userId,
    ver: options.ver ?? 0,
    jti: randomUUID(),
  };
  if (options.exp !== undefined) payload.exp = options.exp;
  return jwt.signAsync(payload, {
    secret: JWT_SECRET,
    ...(options.exp === undefined ? { expiresIn: options.expiresIn ?? 300 } : {}),
  });
}

function openSocket(
  token: string | undefined,
  extraHeaders: Record<string, string> = {},
): ClientSocket {
  const socket: ClientSocket = io(url, {
    path: '/socket.io',
    transports: ['websocket'],
    auth: token === undefined ? {} : { token },
    extraHeaders,
    reconnection: false,
    forceNew: true,
  });
  opened.push(socket);
  return socket;
}

async function connect(token: string): Promise<ClientSocket> {
  const socket = openSocket(token);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

/** 連線應被拒；回傳 `err.data.code`（Origin / IP 限制在 HTTP 升級階段被拒，沒有 code）。 */
async function connectError(
  token: string | undefined,
  extraHeaders?: Record<string, string>,
): Promise<string | undefined> {
  const socket = openSocket(token, extraHeaders);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => reject(new Error('預期連線被拒，但連上了')));
    socket.once('connect_error', (error: Error & { data?: { code?: string } }) =>
      resolve(error.data?.code),
    );
  });
}

function waitFor<T = unknown>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等不到 ${event}`)), EVENT_TIMEOUT_MS);
    (socket as unknown as Socket).once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** 收集一條連線收到的 resource.changed。 */
function collect(socket: ClientSocket): ResourceChanged[] {
  const received: ResourceChanged[] = [];
  socket.on(ServerEvent.RESOURCE_CHANGED, (payload) => received.push(payload));
  return received;
}

const BARRIER_CHANNEL = 'test:barrier';

/**
 * 屏障：等 bus 處理完後，由伺服器對所有連線廣播一則哨兵；同一條連線的事件依序送達，
 * 收到哨兵就代表在它之前推的事件都已經到了（用來斷言「沒收到」，不用 sleep）。
 */
async function barrier(sockets: ClientSocket[]): Promise<void> {
  await bus.drain();
  const id = randomUUID();
  const arrived = sockets.map(
    (socket) =>
      new Promise<void>((resolve) => {
        const onRelay = (envelope: ChannelEnvelopeWire) => {
          if (envelope.channel !== BARRIER_CHANNEL || envelope.id !== id) return;
          socket.off(ServerEvent.CHANNEL_RELAY, onRelay);
          resolve();
        };
        socket.on(ServerEvent.CHANNEL_RELAY, onRelay);
      }),
  );
  app.get(RealtimeGateway).server!.emit(ServerEvent.CHANNEL_RELAY, {
    tag: 'ge-channel',
    channel: BARRIER_CHANNEL,
    type: 'barrier',
    payload: null,
    sender: 'server',
    id,
  });
  await Promise.all(arrived);
}

function relayEnvelope(channel: string): ChannelEnvelopeWire {
  return {
    tag: 'ge-channel',
    channel,
    type: 'set',
    payload: { theme: 'dark' },
    sender: randomUUID(),
    id: randomUUID(),
  };
}

// ── 生命週期 ─────────────────────────────────────────────────

let superAdminToken: string;

describe('即時推播（docs/architecture/backend/08-realtime.md §13）', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = inject('databaseUrl');
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN_EMAIL;
    process.env.SUPER_ADMIN_PASSWORD = 'RealtimeRoot!2026';

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);

    const { AppModule } = await import('@/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REALTIME_LIMITS)
      .useValue({
        ...DEFAULT_REALTIME_LIMITS,
        // 整個檔案都從 127.0.0.1 連線，放寬 IP 上限；每人連線數調小以便測到上限
        handshakesPerIp: 10_000,
        connectionsPerUser: CONNECTIONS_PER_USER,
      })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0);
    http = app.getHttpServer() as App;
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    bus = app.get(DomainEventBus);
    jwt = app.get(JwtService);

    const [root] = await db.select().from(users).where(eq(users.email, SUPER_ADMIN_EMAIL));
    superAdminToken = await tokenFor(root!.id);
  });

  afterEach(() => {
    for (const socket of opened.splice(0)) socket.disconnect();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app?.close();
    await closeDb?.();
  });

  // ── handshake ──────────────────────────────────────────────

  describe('handshake（§3.2、§11）', () => {
    it('沒帶 token → AUTH_TOKEN_INVALID', async () => {
      expect(await connectError(undefined)).toBe('AUTH_TOKEN_INVALID');
    });

    it('token 過期 → AUTH_TOKEN_INVALID', async () => {
      const userId = await createUser('hs-expired@example.com');
      const token = await tokenFor(userId, { exp: Math.floor(Date.now() / 1000) - 10 });
      expect(await connectError(token)).toBe('AUTH_TOKEN_INVALID');
    });

    it('token_version 不符 → AUTH_TOKEN_STALE', async () => {
      const userId = await createUser('hs-stale@example.com');
      expect(await connectError(await tokenFor(userId, { ver: 7 }))).toBe('AUTH_TOKEN_STALE');
    });

    it('帳號停用 → AUTH_ACCOUNT_DISABLED', async () => {
      const userId = await createUser('hs-disabled@example.com');
      await db.update(users).set({ status: 'inactive' }).where(eq(users.id, userId));
      expect(await connectError(await tokenFor(userId))).toBe('AUTH_ACCOUNT_DISABLED');
    });

    it('Origin 不在 REALTIME_ALLOWED_ORIGINS → 拒絕；在清單內 → 連上', async () => {
      const userId = await createUser('hs-origin@example.com');
      const token = await tokenFor(userId);
      await expect(connectError(token, { origin: 'http://evil.example' })).resolves.toBeUndefined();

      const allowed = openSocket(token, { origin: 'http://localhost:5173' });
      await expect(waitFor(allowed, 'connect')).resolves.toBeUndefined();
    });

    it(`每個使用者最多 ${CONNECTIONS_PER_USER} 條連線 → 超過回 RATE_LIMITED`, async () => {
      const userId = await createUser('hs-limit@example.com');
      const token = await tokenFor(userId);
      for (let index = 0; index < CONNECTIONS_PER_USER; index += 1) await connect(token);
      expect(await connectError(token)).toBe('RATE_LIMITED');
    });
  });

  // ── 到期與續期 ─────────────────────────────────────────────

  describe('session.renew 與到期（§3.4）', () => {
    it('換成別人的 token → 拒絕', async () => {
      const alice = await createUser('renew-alice@example.com');
      const bob = await createUser('renew-bob@example.com');
      const socket = await connect(await tokenFor(alice));

      const result = await socket.emitWithAck(ClientEvent.SESSION_RENEW, {
        token: await tokenFor(bob),
      });
      expect(result).toEqual<SessionRenewResult>({ ok: false, code: 'AUTH_TOKEN_INVALID' });
    });

    it('無效 token → 回傳驗證的錯誤碼', async () => {
      const alice = await createUser('renew-invalid@example.com');
      const socket = await connect(await tokenFor(alice));
      const result = await socket.emitWithAck(ClientEvent.SESSION_RENEW, { token: 'garbage' });
      expect(result).toEqual({ ok: false, code: 'AUTH_TOKEN_INVALID' });
    });

    it('到了 exp 沒續期 → 收到 session.expired 並斷線', async () => {
      const userId = await createUser('expiry@example.com');
      const socket = await connect(await tokenFor(userId, { expiresIn: 2 }));
      const expired = waitFor(socket, ServerEvent.SESSION_EXPIRED);
      const disconnected = waitFor<string>(socket, 'disconnect');
      await expect(expired).resolves.toBeUndefined();
      await expect(disconnected).resolves.toBe('io server disconnect');
    });

    it('續期成功 → 期限延到新 token 的 exp，不會在舊的 exp 斷線', async () => {
      const userId = await createUser('renew-ok@example.com');
      const socket = await connect(await tokenFor(userId, { expiresIn: 2 }));
      const result = await socket.emitWithAck(ClientEvent.SESSION_RENEW, {
        token: await tokenFor(userId, { expiresIn: 300 }),
      });
      expect(result).toEqual({ ok: true });

      // 伺服器端的授權期限已換成新 token 的 exp（計時器依它重設）
      const [serverSocket] = await app
        .get(RealtimeGateway)
        .server!.in(userRoom(userId))
        .fetchSockets();
      expect(serverSocket?.data.expiresAt).toBeGreaterThan(Date.now() + 200_000);
    });
  });

  // ── 推播受眾 ───────────────────────────────────────────────

  describe('資源變更推播（§6、§7）', () => {
    it('改角色權限 → 持有者與 role:read 持有者收到（帶 origin），其他人收不到；room 先同步再推', async () => {
      const created = await request(http)
        .post('/roles')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ name: '推播測試角色', permissionKeys: [] })
        .expect(201);
      const roleId = (created.body as { data: { id: string } }).data.id;

      const holder = await createUser('push-holder@example.com', [roleId]);
      const reader = await createUser('push-reader@example.com', [await roleIdOf('auditor')]);
      const outsider = await createUser('push-outsider@example.com');
      await bus.drain(); // 建角色的推播先送完，才開始收

      const holderSocket = await connect(await tokenFor(holder));
      const readerSocket = await connect(await tokenFor(reader));
      const outsiderSocket = await connect(await tokenFor(outsider));
      const holderGot = collect(holderSocket);
      const readerGot = collect(readerSocket);
      const outsiderGot = collect(outsiderSocket);
      const publish = vi.spyOn(bus, 'publish');

      await request(http)
        .patch(`/roles/${roleId}/permissions`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set(CLIENT_ID_HEADER, 'tab-root-1')
        .send({ add: ['user:read'], remove: [] })
        .expect(200);
      await barrier([holderSocket, readerSocket, outsiderSocket]);

      const expected: ResourceChanged = {
        changes: [{ resource: 'rolePermission', kind: 'update', id: roleId }],
        origin: 'tab-root-1',
      };
      expect(holderGot).toEqual([expected]);
      expect(readerGot).toEqual([expected]);
      expect(outsiderGot).toEqual([]);

      // 權限集合改變的事件在推播之前發佈（bus 依序處理 → room 先同步）
      expect(publish.mock.calls.map(([type]) => type)).toEqual([
        DomainEvent.PERMISSIONS_CHANGED,
        DomainEvent.RESOURCE_CHANGED,
      ]);
      expect(publish.mock.calls[0]?.[1]).toEqual({ userIds: [holder] });

      // 持有者剛拿到 user:read：下一筆使用者變更就會收到（room 已同步）
      holderGot.length = 0;
      await request(http)
        .patch(`/users/${outsider}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ displayName: '改個名字' })
        .expect(200);
      await barrier([holderSocket]);
      expect(holderGot.map((event) => event.changes[0]?.resource)).toEqual(['user']);
    });

    it('被拿掉 role:read 之後不再收到角色變更', async () => {
      const created = await request(http)
        .post('/roles')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ name: '會失去 role:read 的角色', permissionKeys: ['role:read'] })
        .expect(201);
      const roleId = (created.body as { data: { id: string } }).data.id;
      const userId = await createUser('lose-read@example.com', [roleId]);
      await bus.drain();
      const socket = await connect(await tokenFor(userId));
      const got = collect(socket);

      await request(http)
        .post('/roles')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ name: '拿掉之前建立', permissionKeys: [] })
        .expect(201);
      await barrier([socket]);
      expect(got.map((event) => event.changes[0]?.kind)).toEqual(['create']);

      await request(http)
        .patch(`/roles/${roleId}/permissions`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ add: [], remove: ['role:read'] })
        .expect(200);
      await barrier([socket]);
      got.length = 0;

      await request(http)
        .post('/roles')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ name: '拿掉之後建立', permissionKeys: [] })
        .expect(201);
      await barrier([socket]);
      expect(got).toEqual([]);
    });

    it('指派角色 → 本人收到 userRole（room 同步後也開始收到新權限的推播）', async () => {
      const target = await createUser('assign-target@example.com');
      await bus.drain();
      const socket = await connect(await tokenFor(target));
      const got = collect(socket);
      const auditorId = await roleIdOf('auditor');

      await request(http)
        .put(`/users/${target}/roles`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ roleIds: [auditorId] })
        .expect(200);
      await barrier([socket]);
      expect(got[0]).toEqual({
        changes: [
          { resource: 'userRole', kind: 'update', id: target, refs: { role: [auditorId] } },
        ],
      });
      // auditor 是平台角色：不帶檔案權限，不會建立個人資料夾（docs/adr/0018-workspace-tenancy.md D2）
      expect(got.slice(1)).toEqual([]);

      // 拿到 role:read（auditor）之後，別人的角色建立也會推過來
      got.length = 0;
      await request(http)
        .post('/roles')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ name: '指派之後建立', permissionKeys: [] })
        .expect(201);
      await barrier([socket]);
      expect(got.map((event) => event.changes[0]?.resource)).toEqual(['role']);
    });

    it('x-client-id 格式不合 → 不帶 origin', async () => {
      const reader = await createUser('origin-reader@example.com', [await roleIdOf('auditor')]);
      await bus.drain();
      const socket = await connect(await tokenFor(reader));
      const got = collect(socket);

      await request(http)
        .post('/roles')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set(CLIENT_ID_HEADER, 'not valid!')
        .send({ name: 'origin 測試角色', permissionKeys: [] })
        .expect(201);
      await barrier([socket]);
      expect(got).toHaveLength(1);
      expect(got[0]).not.toHaveProperty('origin');
    });

    it('交易 rollback → 沒有任何推播', async () => {
      const created = await request(http)
        .post('/roles')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ name: 'rollback 測試角色', permissionKeys: [] })
        .expect(201);
      const roleId = (created.body as { data: { id: string } }).data.id;
      const reader = await createUser('rollback-reader@example.com', [await roleIdOf('auditor')]);
      await bus.drain();
      const socket = await connect(await tokenFor(reader));
      const got = collect(socket);

      // 交易內的稽核寫入失敗 → 整筆 rollback
      vi.spyOn(app.get(AuditService), 'record').mockRejectedValueOnce(new Error('boom'));
      const publish = vi.spyOn(bus, 'publish');
      await request(http)
        .patch(`/roles/${roleId}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ name: '不會成功的新名字' })
        .expect(500);
      await barrier([socket]);

      expect(publish).not.toHaveBeenCalled();
      expect(got).toEqual([]);
    });
  });

  // ── 工作區 ─────────────────────────────────────────────────

  describe('工作區的推播（docs/adr/0018-workspace-tenancy.md D16）', () => {
    let wsA = '';
    let wsB = '';
    let wsC = '';
    let member = '';
    let memberRole = '';

    beforeAll(async () => {
      wsA = await createWorkspace(db, 'realtime-a');
      wsB = await createWorkspace(db, 'realtime-b');
      wsC = await createWorkspace(db, 'realtime-c');
      memberRole = await roleIdOf('workspace-member');
      member = await createUser('realtime-ws-member@example.com');
      // A、B 的成員，不是 C 的
      await assignRoles(db, member, [memberRole], wsA);
      await assignRoles(db, member, [memberRole], wsB);
    });

    /** handshake 通過（客戶端的 connect）時，伺服器可能還在查權限、加入 room：等它加入。 */
    const joined = (workspaceId: string) =>
      expect
        .poll(
          () =>
            app
              .get(RealtimeGateway)
              .server!.sockets.adapter.rooms.get(`ws:${workspaceId}:perm:file:access`)?.size ?? 0,
        )
        .toBeGreaterThan(0);

    const fileChanged = (workspaceId: string) =>
      bus.publish(DomainEvent.RESOURCE_CHANGED, {
        changes: [{ resource: 'file', kind: 'update', id: randomUUID() }],
        workspaceId,
      });

    it('收到所屬每個工作區的變更（leader 分頁代表所有分頁），不屬於的收不到', async () => {
      const socket = await connect(await tokenFor(member));
      const got = collect(socket);
      await joined(wsA);
      await joined(wsB);

      fileChanged(wsA);
      fileChanged(wsB);
      fileChanged(wsC);
      await barrier([socket]);
      expect(got).toHaveLength(2);
    });

    it('被移出工作區 → 立刻收不到它的變更', async () => {
      const leaver = await createUser('realtime-ws-leaver@example.com');
      await assignRoles(db, leaver, [memberRole], wsA);
      // 讓 wsA 有一位管理員，移除成員時才不會違反「至少一位管理員」
      const admin = await createUser('realtime-ws-admin@example.com');
      await assignRoles(db, admin, [await roleIdOf('workspace-admin')], wsA);

      const socket = await connect(await tokenFor(leaver));
      const got = collect(socket);
      await joined(wsA);
      fileChanged(wsA);
      await barrier([socket]);
      expect(got).toHaveLength(1);

      await request(http)
        .delete(`${workspacePath(wsA)}/members/${leaver}`)
        .set('Authorization', `Bearer ${await tokenFor(admin)}`)
        .expect(204);
      await barrier([socket]);
      got.length = 0;

      fileChanged(wsA);
      await barrier([socket]);
      expect(got).toEqual([]);
    });

    it('沒帶 workspaceId 的工作區變更：誰都不推（寧可漏推也不跨工作區）', async () => {
      const socket = await connect(await tokenFor(member));
      const got = collect(socket);
      bus.publish(DomainEvent.RESOURCE_CHANGED, {
        changes: [{ resource: 'fileFolder', kind: 'create' }],
      });
      await barrier([socket]);
      // 只剩 auditLog:read 的 room，member 不在裡面
      expect(got).toEqual([]);
    });
  });

  // ── 撤銷 ───────────────────────────────────────────────────

  describe('撤銷（§3.5）', () => {
    it('停用使用者 → 該使用者所有連線收到 session.revoked 並被斷線', async () => {
      const userId = await createUser('revoke-me@example.com');
      const token = await tokenFor(userId);
      const sockets = [await connect(token), await connect(token)];
      const revoked = sockets.map((socket) => waitFor(socket, ServerEvent.SESSION_REVOKED));
      const disconnected = sockets.map((socket) => waitFor<string>(socket, 'disconnect'));

      await request(http)
        .patch(`/users/${userId}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ status: 'inactive' })
        .expect(200);

      await expect(Promise.all(revoked)).resolves.toEqual([
        { reason: 'AUTH_ACCOUNT_DISABLED' },
        { reason: 'AUTH_ACCOUNT_DISABLED' },
      ]);
      await expect(Promise.all(disconnected)).resolves.toEqual([
        'io server disconnect',
        'io server disconnect',
      ]);
    });

    it('登入失敗次數達上限被鎖定 → 既有連線收到 session.revoked 並被斷線', async () => {
      const { hashPassword } = await import('@/modules/auth/password');
      const email = 'lock-me@example.com';
      const [user] = await db
        .insert(users)
        .values({
          email,
          displayName: email,
          status: 'active',
          passwordHash: await hashPassword('CorrectPassword!2026'),
        })
        .returning();
      const socket = await connect(await tokenFor(user!.id));
      const revoked = waitFor(socket, ServerEvent.SESSION_REVOKED);
      const disconnected = waitFor<string>(socket, 'disconnect');

      const maxAttempts = Number(process.env.LOGIN_MAX_ATTEMPTS ?? 5);
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        // 依序送出：每次失敗都要讀到上一次寫入的累計次數
        // oxlint-disable-next-line no-await-in-loop
        await request(http).post('/auth/login').send({ email, password: 'WrongPassword!2026' });
      }

      await expect(revoked).resolves.toEqual({ reason: 'AUTH_ACCOUNT_DISABLED' });
      await expect(disconnected).resolves.toBe('io server disconnect');
    });

    it('token_version 被改（未經 service）→ 下一則訊息被 WsAuthGuard 拒絕並斷線', async () => {
      const userId = await createUser('stale-ws@example.com');
      const socket = await connect(await tokenFor(userId));
      await db.update(users).set({ tokenVersion: 1 }).where(eq(users.id, userId));
      // UserCacheService 的 30 秒 TTL：模擬快取已過期
      const { UserCacheService } = await import('@/core/cache');
      app.get(UserCacheService).invalidate(userId);

      const disconnected = waitFor<string>(socket, 'disconnect');
      socket.emit(ClientEvent.CHANNEL_RELAY, relayEnvelope('ge:store:preference:theme'));
      await expect(disconnected).resolves.toBe('io server disconnect');
    });
  });

  // ── 跨裝置中繼 ─────────────────────────────────────────────

  describe('channel.relay（§8）', () => {
    it('只轉給同使用者的其他連線；非白名單頻道被略過', async () => {
      const alice = await createUser('relay-alice@example.com');
      const bob = await createUser('relay-bob@example.com');
      const aliceToken = await tokenFor(alice);
      const [sender, sibling, stranger] = [
        await connect(aliceToken),
        await connect(aliceToken),
        await connect(await tokenFor(bob)),
      ];
      const got = new Map<ClientSocket, string[]>();
      for (const socket of [sender!, sibling!, stranger!]) {
        const channels: string[] = [];
        socket.on(ServerEvent.CHANNEL_RELAY, (envelope) => {
          if (envelope.channel !== BARRIER_CHANNEL) channels.push(envelope.channel);
        });
        got.set(socket, channels);
      }

      sender!.emit(ClientEvent.CHANNEL_RELAY, relayEnvelope('session:token'));
      sender!.emit(ClientEvent.CHANNEL_RELAY, relayEnvelope('ge:store:preference:theme'));
      // 讓伺服器處理完 sender 的訊息：同一條連線的 ack 依序回來
      await sender!.emitWithAck(ClientEvent.SESSION_RENEW, { token: aliceToken });
      await barrier([sender!, sibling!, stranger!]);

      expect(got.get(sibling!)).toEqual(['ge:store:preference:theme']);
      expect(got.get(sender!)).toEqual([]);
      expect(got.get(stranger!)).toEqual([]);
    });
  });
});
