import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingHttpHeaders, Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  auditLogs,
  notifications,
  relationTuples,
  roleHolderTuple,
  roles,
  users,
  webhookDeliveries,
  webhookEvents,
  webhookSubscriptions,
} from '@/db/schema';
import { WEBHOOK_AUTO_DISABLE_AFTER_FAILURES } from '@/modules/webhook/webhook.constants';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { testTenantContext } from './tenant';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;
let tenantCode: string;

const ROOT = { email: 'wh-root@example.com', password: 'RootPassword!2026' };
const AUDITOR = { email: 'wh-auditor@example.com', password: 'AuditorPassword!2026' };

interface Received {
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

/** 本機的接收端：`/ok` 回 200、`/fail` 回 500；收到的請求依序記下。 */
class Receiver {
  readonly requests: Received[] = [];
  private server: Server | undefined;
  base = '';

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        this.requests.push({
          path: req.url ?? '',
          headers: req.headers,
          body: Buffer.concat(chunks).toString(),
        });
        if (req.url === '/fail') res.writeHead(500).end('receiver broke');
        else res.writeHead(200).end('thanks');
      });
    });
    const server = this.server;
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    this.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((done) => (this.server ? this.server.close(() => done()) : done()));
  }

  of(path: string, type: string): Received[] {
    return this.requests.filter(
      (received) => received.path === path && received.headers['x-webhook-event'] === type,
    );
  }
}

const receiver = new Receiver();
const sessions = new Map<string, string>();

async function login(credentials: { email: string; password: string }): Promise<string> {
  const cached = sessions.get(credentials.email);
  if (cached) return cached;
  const response = await request(http).post('/auth/login').send(credentials).expect(200);
  const token = (response.body as { data: { accessToken: string } }).data.accessToken;
  sessions.set(credentials.email, token);
  return token;
}

async function as(credentials: { email: string; password: string }) {
  const auth = { authorization: `Bearer ${await login(credentials)}` };
  return {
    get: (path: string) => request(http).get(path).set(auth),
    post: (path: string, body?: object) => request(http).post(path).set(auth).send(body),
    patch: (path: string, body: object) => request(http).patch(path).set(auth).send(body),
    delete: (path: string) => request(http).delete(path).set(auth),
  };
}

function dataOf<T>(response: request.Response): T {
  return (response.body as { data: T }).data;
}

function errorOf(response: request.Response): { code: string; details?: Record<string, unknown> } {
  return (response.body as { error: { code: string; details?: Record<string, unknown> } }).error;
}

interface WebhookBody {
  id: string;
  status: string;
  disabledReason: string | null;
  consecutiveFailures: number;
  version: number;
  events: string[];
}

interface DeliveryBody {
  id: string;
  eventId: string;
  eventType: string;
  attempt: number;
  trigger: string;
  succeeded: boolean;
  responseStatus: number | null;
  responseBody: string | null;
}

/** worker 以輪詢取工作：等到接收端收到第 `count` 個這種事件。 */
function waitForRequests(path: string, type: string, count = 1): Promise<Received[]> {
  return vi.waitFor(
    () => {
      const found = receiver.of(path, type);
      expect(found.length).toBeGreaterThanOrEqual(count);
      return found;
    },
    { timeout: 20_000, interval: 200 },
  );
}

const ids: Record<string, string> = {};
const secrets: Record<string, string> = {};

describe('Webhook（docs/adr/0030-webhooks.md）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = ROOT.email;
    process.env.SUPER_ADMIN_PASSWORD = ROOT.password;
    process.env.JOBS_WORKER_ENABLED = 'true';
    process.env.AUDIT_LOG_ARCHIVE_CRON = '';
    process.env.FILE_MAINTENANCE_CRON = '';
    process.env.AUTH_RATE_LIMIT = '1000';

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);

    const { hashPassword } = await import('@/modules/credential/password');
    const [auditor] = await db
      .insert(users)
      .values({
        email: AUDITOR.email,
        displayName: 'Auditor',
        passwordHash: await hashPassword(AUDITOR.password),
        status: 'active',
      })
      .returning();
    const [auditorRole] = await db.select().from(roles).where(eq(roles.slug, 'auditor'));
    await db.insert(relationTuples).values(roleHolderTuple(auditorRole!.id, auditor!.id));

    await receiver.start();
    const { AppModule } = await import('@/app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    http = await listenOnLoopback(app);
    tenantCode = (await testTenantContext(app)).code;
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    await receiver.stop();
    for (const key of [
      'JOBS_WORKER_ENABLED',
      'AUDIT_LOG_ARCHIVE_CRON',
      'FILE_MAINTENANCE_CRON',
      'AUTH_RATE_LIMIT',
    ]) {
      delete process.env[key];
    }
  });

  it('可訂閱的事件：第一批，不含 webhook.ping', async () => {
    const root = await as(ROOT);
    const listed = dataOf<{ items: { type: string }[] }>(
      await root.get('/webhooks/events').expect(200),
    );
    expect(listed.items.map((item) => item.type)).toEqual(
      expect.arrayContaining([
        'user.created',
        'user.statusChanged',
        'user.deleted',
        'user.restored',
        'approval.decided',
        'file.uploaded',
      ]),
    );
    expect(listed.items.map((item) => item.type)).not.toContain('webhook.ping');
  });

  it('建立：密鑰只出現在回應，資料庫存的是密文；寫稽核', async () => {
    const root = await as(ROOT);
    const ok = dataOf<{ secret: string; webhook: WebhookBody }>(
      await root
        .post('/webhooks', {
          name: '正常的接收端',
          url: `${receiver.base}/ok`,
          events: ['user.created', 'user.statusChanged'],
        })
        .expect(201),
    );
    ids.ok = ok.webhook.id;
    secrets.ok = ok.secret;
    expect(ok.webhook).toMatchObject({ status: 'active', consecutiveFailures: 0, version: 1 });

    const [row] = await db
      .select()
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.id, ids.ok!));
    expect(row!.secretEncrypted).not.toContain(ok.secret);
    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'webhook.create'), eq(auditLogs.resourceId, ids.ok)));
    expect(JSON.stringify(audit!.changes)).not.toContain(ok.secret);

    const failing = dataOf<{ webhook: WebhookBody }>(
      await root
        .post('/webhooks', {
          name: '壞掉的接收端',
          url: `${receiver.base}/fail`,
          events: ['user.created'],
        })
        .expect(201),
    );
    ids.failing = failing.webhook.id;
  });

  it('訂閱沒有登記的事件 → 400 WEBHOOK_EVENT_UNKNOWN', async () => {
    const root = await as(ROOT);
    const response = await root
      .post('/webhooks', { name: 'x', url: `${receiver.base}/ok`, events: ['webhook.ping'] })
      .expect(400);
    expect(errorOf(response)).toMatchObject({
      code: 'WEBHOOK_EVENT_UNKNOWN',
      details: { events: ['webhook.ping'] },
    });
  });

  it('auditor 看得到但不能建立（webhook:read 沒有 create）', async () => {
    const auditor = await as(AUDITOR);
    await auditor.get('/webhooks').expect(200);
    await auditor
      .post('/webhooks', { name: 'x', url: `${receiver.base}/ok`, events: ['user.created'] })
      .expect(403);
  });

  it('建立使用者 → 投遞 user.created：簽章對得上、payload 只有 id、紀錄成功', async () => {
    const root = await as(ROOT);
    const created = await root
      .post('/users', { email: 'wh-new@example.com', displayName: '新成員', roleIds: [] })
      .expect(201);
    ids.user = dataOf<{ id: string }>(created).id;

    const [received] = await waitForRequests('/ok', 'user.created');
    const timestamp = received!.headers['x-webhook-timestamp'] as string;
    const expected = createHmac('sha256', secrets.ok!)
      .update(`${timestamp}.${received!.body}`)
      .digest('hex');
    expect(received!.headers['x-webhook-signature']).toBe(`sha256=${expected}`);
    const body = JSON.parse(received!.body) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: 'user.created',
      version: 1,
      tenant: tenantCode,
      data: { userId: ids.user },
    });
    expect(received!.headers['x-webhook-id']).toBe(body.id);
    expect(received!.body).not.toContain('wh-new@example.com');

    const deliveries = await vi.waitFor(
      async () => {
        const listed = dataOf<{ items: DeliveryBody[] }>(
          await root.get(`/webhooks/${ids.ok}/deliveries`).expect(200),
        );
        expect(listed.items).toHaveLength(1);
        return listed.items;
      },
      { timeout: 5000, interval: 100 },
    );
    expect(deliveries[0]).toMatchObject({
      eventType: 'user.created',
      attempt: 1,
      trigger: 'auto',
      succeeded: true,
      responseStatus: 200,
      responseBody: 'thanks',
    });
    ids.okDelivery = deliveries[0]!.id;
  });

  it('接收端回 500：紀錄失敗、失敗次數加一（之後由 pg-boss 退避重試）', async () => {
    await waitForRequests('/fail', 'user.created');
    const root = await as(ROOT);
    const webhook = await vi.waitFor(
      async () => {
        const found = dataOf<WebhookBody>(await root.get(`/webhooks/${ids.failing}`).expect(200));
        expect(found.consecutiveFailures).toBe(1);
        return found;
      },
      { timeout: 5000, interval: 100 },
    );
    expect(webhook.status).toBe('active');
    const listed = dataOf<{ items: DeliveryBody[] }>(
      await root.get(`/webhooks/${ids.failing}/deliveries?succeeded=false`).expect(200),
    );
    expect(listed.items[0]).toMatchObject({
      succeeded: false,
      responseStatus: 500,
      responseBody: 'receiver broke',
    });
  });

  it('停用使用者 → user.statusChanged 帶前後狀態；沒訂閱這個事件的不會收到', async () => {
    const root = await as(ROOT);
    const user = dataOf<{ version: number }>(await root.get(`/users/${ids.user}`).expect(200));
    await root
      .patch(`/users/${ids.user}`, { status: 'inactive', version: user.version })
      .expect(200);
    const [received] = await waitForRequests('/ok', 'user.statusChanged');
    expect(JSON.parse(received!.body)).toMatchObject({
      data: { userId: ids.user, status: 'inactive', previousStatus: 'pending' },
    });
    expect(receiver.of('/fail', 'user.statusChanged')).toHaveLength(0);
  });

  it('送測試事件：同步回傳這一次的投遞紀錄（webhook.ping）', async () => {
    const root = await as(ROOT);
    const delivery = dataOf<DeliveryBody>(await root.post(`/webhooks/${ids.ok}/test`).expect(201));
    expect(delivery).toMatchObject({
      eventType: 'webhook.ping',
      trigger: 'manual',
      succeeded: true,
    });
    const [ping] = receiver.of('/ok', 'webhook.ping');
    expect(JSON.parse(ping!.body)).toMatchObject({ data: { webhookId: ids.ok } });
  });

  it('重送：事件 id 不變，第幾次接續', async () => {
    const root = await as(ROOT);
    const delivery = dataOf<DeliveryBody>(
      await root.post(`/webhooks/${ids.ok}/deliveries/${ids.okDelivery}/redeliver`).expect(201),
    );
    expect(delivery).toMatchObject({ attempt: 2, trigger: 'manual', succeeded: true });
    const sent = receiver.of('/ok', 'user.created');
    expect(sent).toHaveLength(2);
    expect(sent[1]!.headers['x-webhook-id']).toBe(sent[0]!.headers['x-webhook-id']);
  });

  it('輪替密鑰：之後的投遞用新的密鑰簽', async () => {
    const root = await as(ROOT);
    const rotated = dataOf<{ secret: string }>(
      await root.post(`/webhooks/${ids.ok}/rotate-secret`).expect(201),
    );
    expect(rotated.secret).not.toBe(secrets.ok);
    await root.post(`/webhooks/${ids.ok}/test`).expect(201);
    const pings = receiver.of('/ok', 'webhook.ping');
    const last = pings[pings.length - 1]!;
    const expected = createHmac('sha256', rotated.secret)
      .update(`${last.headers['x-webhook-timestamp'] as string}.${last.body}`)
      .digest('hex');
    expect(last.headers['x-webhook-signature']).toBe(`sha256=${expected}`);
  });

  it('樂觀鎖與停用：舊版本 409；停用後不能送測試事件，事件也不再入列', async () => {
    const root = await as(ROOT);
    const current = dataOf<WebhookBody>(await root.get(`/webhooks/${ids.ok}`).expect(200));
    const stale = await root
      .patch(`/webhooks/${ids.ok}`, { name: 'x', version: current.version + 1 })
      .expect(409);
    expect(errorOf(stale)).toMatchObject({
      code: 'WEBHOOK_VERSION_CONFLICT',
      details: { current: current.version },
    });

    const disabled = dataOf<WebhookBody>(
      await root
        .patch(`/webhooks/${ids.ok}`, { status: 'disabled', version: current.version })
        .expect(200),
    );
    expect(disabled).toMatchObject({ status: 'disabled', disabledReason: 'manual' });
    expect(errorOf(await root.post(`/webhooks/${ids.ok}/test`).expect(409)).code).toBe(
      'WEBHOOK_DISABLED',
    );

    const before = await db.select().from(webhookEvents);
    await root
      .post('/users', { email: 'wh-quiet@example.com', displayName: 'quiet', roleIds: [] })
      .expect(201);
    // 只剩壞掉的接收端訂閱 user.created：事件仍然寫一筆（給它），但沒有給停用中的訂閱的投遞
    const after = await db.select().from(webhookEvents);
    expect(after.length).toBe(before.length + 1);
    await waitForRequests('/fail', 'user.created', 2);
    const okDeliveries = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.subscriptionId, ids.ok!));
    expect(okDeliveries.map((row) => row.eventId)).not.toContain(after[after.length - 1]!.id);
  });

  it('連續失敗到門檻自動停用：寫稽核、通知持有 webhook:update 的人（D13）', async () => {
    await db
      .update(webhookSubscriptions)
      .set({ consecutiveFailures: WEBHOOK_AUTO_DISABLE_AFTER_FAILURES - 1 })
      .where(eq(webhookSubscriptions.id, ids.failing!));
    const root = await as(ROOT);
    await root
      .post('/users', { email: 'wh-last-straw@example.com', displayName: 'last', roleIds: [] })
      .expect(201);

    const webhook = await vi.waitFor(
      async () => {
        const found = dataOf<WebhookBody>(await root.get(`/webhooks/${ids.failing}`).expect(200));
        expect(found.status).toBe('disabled');
        return found;
      },
      { timeout: 20_000, interval: 200 },
    );
    expect(webhook).toMatchObject({
      disabledReason: 'failing',
      consecutiveFailures: WEBHOOK_AUTO_DISABLE_AFTER_FAILURES,
    });
    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.action, 'webhook.autoDisable'), eq(auditLogs.resourceId, ids.failing!)),
      );
    expect(audit).toMatchObject({ actorId: null, actorEmail: 'system' });
    const sent = await db
      .select()
      .from(notifications)
      .where(eq(notifications.type, 'webhook.disabled'));
    expect(sent.length).toBeGreaterThan(0);
    expect(sent[0]).toMatchObject({
      params: { webhookName: '壞掉的接收端', consecutiveFailures: 50 },
      link: { route: 'webhook.detail', params: { webhookId: ids.failing } },
    });
  });

  it('刪除：硬刪除，投遞紀錄一併刪除', async () => {
    const root = await as(ROOT);
    await root.delete(`/webhooks/${ids.failing}`).expect(204);
    await root.get(`/webhooks/${ids.failing}`).expect(404);
    const left = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.subscriptionId, ids.failing!));
    expect(left).toHaveLength(0);
  });
});
