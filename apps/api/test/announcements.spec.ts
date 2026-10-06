import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { TENANT_DB, withTransaction } from '@/core/database';
import type { Database } from '@/core/database';
import {
  announcementDispatches,
  announcements,
  auditLogs,
  groupMemberTuple,
  groupRoleTuple,
  groups,
  jobOutbox,
  notifications,
  relationTuples,
  roleHolderTuple,
  rolePermissionTuple,
  roles,
  users,
} from '@/db/schema';
import { AnnouncementDispatchService } from '@/modules/announcement/announcement-dispatch.service';
import { AnnouncementAudienceResolver } from '@/modules/announcement/announcement.audience';
import { UserAccountService } from '@/modules/user/user-account.service';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { inTestTenant } from './tenant';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;

const PASSWORD = 'AnnouncePassword!2026';
const ROOT = { email: 'an-root@example.com', password: 'Quiet-Harbor-Lantern-26' };
const AUDITOR = { email: 'an-auditor@example.com', password: PASSWORD };
/** 能寫草稿、不能發送（沒有 announcement:publish）。 */
const EDITOR = { email: 'an-editor@example.com', password: PASSWORD };
const M1 = { email: 'an-m1@example.com', password: PASSWORD };
const M2 = { email: 'an-m2@example.com', password: PASSWORD };
const M3 = { email: 'an-m3@example.com', password: PASSWORD };
const M4_INACTIVE = { email: 'an-m4@example.com', password: PASSWORD };

const ids: Record<string, string> = {};
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
    put: (path: string, body: object) => request(http).put(path).set(auth).send(body),
    delete: (path: string) => request(http).delete(path).set(auth),
  };
}

function dataOf<T>(response: request.Response): T {
  return (response.body as { data: T }).data;
}

function errorOf(response: request.Response): { code: string; details?: Record<string, unknown> } {
  return (response.body as { error: { code: string; details?: Record<string, unknown> } }).error;
}

interface AnnouncementBody {
  id: string;
  status: string;
  version: number;
  nextRunAt: string | null;
  lastDispatch: { id: string; status: string; recipientCount: number | null } | null;
}

interface DispatchBody {
  id: string;
  audience: { userIds: string[] };
  status: string;
  recipientCount: number | null;
  readCount: number;
  details: Record<string, unknown> | null;
}

async function createUser(
  credentials: { email: string },
  values: Partial<typeof users.$inferInsert> = {},
): Promise<string> {
  const { hashPassword } = await import('@/modules/credential/password');
  const [user] = await db
    .insert(users)
    .values({
      email: credentials.email,
      displayName: `顯示 ${credentials.email}`,
      passwordHash: await hashPassword(PASSWORD),
      status: 'active',
      ...values,
    })
    .returning();
  return user!.id;
}

async function roleIdOf(slug: string): Promise<string> {
  const [role] = await db.select().from(roles).where(eq(roles.slug, slug));
  return role!.id;
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    title: '系統維護通知',
    body: '本週六 22:00～24:00 系統維護，請提前存檔。',
    audience: { groupIds: [ids.g1], roleIds: [ids.role], userIds: [ids.root, ids.m4] },
    trigger: { kind: 'immediate' },
    ...overrides,
  };
}

async function dispatchesOf(announcementId: string): Promise<DispatchBody[]> {
  const root = await as(ROOT);
  return dataOf<{ items: DispatchBody[] }>(
    await root.get(`/announcements/${announcementId}/dispatches`).expect(200),
  ).items;
}

/** worker 以輪詢取工作：等到最近一次發送是 `status`。 */
function waitForDispatch(announcementId: string, status: string): Promise<DispatchBody> {
  return vi.waitFor(
    async () => {
      const [latest] = await dispatchesOf(announcementId);
      expect(latest?.status).toBe(status);
      return latest!;
    },
    { timeout: 20_000, interval: 250 },
  );
}

describe('公告與排程通知（docs/architecture/backend/19-announcement.md §9 A2～A4）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = ROOT.email;
    process.env.SUPER_ADMIN_PASSWORD = ROOT.password;
    process.env.JOBS_WORKER_ENABLED = 'true';
    process.env.AUDIT_LOG_ARCHIVE_CRON = '';
    process.env.FILE_MAINTENANCE_CRON = '';
    process.env.AUTH_RATE_LIMIT = '1000';
    // 等背景工作時會輪詢 API：不要被一般的速率限制擋下
    process.env.DEFAULT_RATE_LIMIT = '100000';

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);

    const [root] = await db.select().from(users).where(eq(users.email, ROOT.email));
    ids.root = root!.id;
    ids.auditor = await createUser(AUDITOR);
    await db.insert(relationTuples).values(roleHolderTuple(await roleIdOf('auditor'), ids.auditor));

    // 編輯者：自訂角色，有 announcement:create（⇒ update ⇒ read）但沒有 publish
    const [editorRole] = await db
      .insert(roles)
      .values({ slug: 'announcement-editor', name: '公告編輯', isSystem: false })
      .returning();
    ids.editor = await createUser(EDITOR);
    await db
      .insert(relationTuples)
      .values([
        rolePermissionTuple(editorRole!.id, 'announcement:create'),
        rolePermissionTuple(editorRole!.id, 'user:read'),
        rolePermissionTuple(editorRole!.id, 'group:read'),
        rolePermissionTuple(editorRole!.id, 'role:read'),
        roleHolderTuple(editorRole!.id, ids.editor),
      ]);

    // 受眾：G1 的直接成員 m1、G1 底下的 G2 的成員 m2、持有「公告收件」角色的 m3；m4 停用中
    ids.m1 = await createUser(M1);
    ids.m2 = await createUser(M2);
    ids.m3 = await createUser(M3);
    ids.m4 = await createUser(M4_INACTIVE, { status: 'inactive' });
    const [g1, g2] = await db
      .insert(groups)
      .values([{ name: '公告-財務' }, { name: '公告-應付' }])
      .returning();
    ids.g1 = g1!.id;
    ids.g2 = g2!.id;
    const [audienceRole] = await db
      .insert(roles)
      .values({ slug: 'announcement-audience', name: '公告收件', isSystem: false })
      .returning();
    ids.role = audienceRole!.id;
    await db
      .insert(relationTuples)
      .values([
        groupMemberTuple(ids.g1, { type: 'user', id: ids.m1 }),
        groupMemberTuple(ids.g1, { type: 'group', id: ids.g2 }),
        groupMemberTuple(ids.g2, { type: 'user', id: ids.m2 }),
        groupMemberTuple(ids.g1, { type: 'user', id: ids.m4 }),
        roleHolderTuple(ids.role, ids.m3),
      ]);

    const { AppModule } = await import('@/app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    http = await listenOnLoopback(app);
  });

  afterAll(async () => {
    await app?.close();
    await closeDb?.();
    for (const key of [
      'JOBS_WORKER_ENABLED',
      'AUDIT_LOG_ARCHIVE_CRON',
      'FILE_MAINTENANCE_CRON',
      'AUTH_RATE_LIMIT',
      'DEFAULT_RATE_LIMIT',
    ]) {
      delete process.env[key];
    }
  });

  // ── 權限 ─────────────────────────────────────────────

  it('auditor 看得到列表但不能建立；一般成員看不到', async () => {
    await (await as(AUDITOR)).get('/announcements').expect(200);
    await (await as(AUDITOR)).post('/announcements', draft()).expect(403);
    await (await as(M1)).get('/announcements').expect(403);
  });

  it('編輯者建立草稿 → draft、寫稽核；不能送出（沒有 announcement:publish）', async () => {
    const editor = await as(EDITOR);
    const created = dataOf<AnnouncementBody>(
      await editor.post('/announcements', draft()).expect(201),
    );
    expect(created).toMatchObject({
      status: 'draft',
      version: 1,
      nextRunAt: null,
      lastDispatch: null,
    });
    ids.immediate = created.id;
    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.action, 'announcement.create'), eq(auditLogs.resourceId, created.id)),
      );
    expect(audit).toBeDefined();
    await editor.post(`/announcements/${created.id}/publish`, { version: 1 }).expect(403);
  });

  // ── 受眾 ─────────────────────────────────────────────

  it('受眾預覽：巢狀群組、角色、指定的人取聯集，只算可登入的；不存在的來源列在 skipped', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    const preview = dataOf<{ count: number; skipped: Record<string, string[]> }>(
      await (
        await as(EDITOR)
      )
        .post('/announcements/audience-preview', {
          groupIds: [ids.g1, missing],
          roleIds: [ids.role],
          userIds: [ids.m4],
        })
        .expect(200),
    );
    // m1（G1）、m2（G1 ⊃ G2）、m3（角色）；m4 停用中
    expect(preview.count).toBe(3);
    expect(preview.skipped).toEqual({ userIds: [ids.m4], groupIds: [missing], roleIds: [] });
  });

  it('送出沒有受眾的草稿 → 400 ANNOUNCEMENT_AUDIENCE_EMPTY', async () => {
    const root = await as(ROOT);
    const empty = dataOf<AnnouncementBody>(
      await root.post('/announcements', draft({ audience: {} })).expect(201),
    );
    const response = await root
      .post(`/announcements/${empty.id}/publish`, { version: 1 })
      .expect(400);
    expect(errorOf(response).code).toBe('ANNOUNCEMENT_AUDIENCE_EMPTY');
  });

  // ── 立即發送 ─────────────────────────────────────────

  it('立即發送：completed、交易內入列分批寫入；每位收件人一則通知（不含送出者自己與停用的人）', async () => {
    const root = await as(ROOT);
    const published = dataOf<AnnouncementBody>(
      await root.post(`/announcements/${ids.immediate}/publish`, { version: 1 }).expect(200),
    );
    expect(published.status).toBe('completed');
    expect(published.lastDispatch).toMatchObject({
      status: expect.stringMatching(/pending|sending|sent/),
    });

    const dispatch = await waitForDispatch(ids.immediate!, 'sent');
    ids.dispatch = dispatch.id;
    expect(dispatch.recipientCount).toBe(3);
    expect(dispatch.details).toMatchObject({ skipped: { userIds: [ids.m4] } });

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.sourceId, dispatch.id));
    expect(rows.map((row) => row.recipientId).toSorted()).toEqual(
      [ids.m1, ids.m2, ids.m3].toSorted(),
    );
    expect(rows[0]).toMatchObject({
      type: 'announcement.published',
      params: { title: '系統維護通知' },
      link: { route: 'announcement.message', params: { dispatchId: dispatch.id } },
      actorId: ids.root,
    });
  });

  it('分批寫入可以重做：再跑一次不重複寫；已完成的發送直接略過', async () => {
    const service = app.get(AnnouncementDispatchService);
    expect(await inTestTenant(app, () => service.fanOut({ dispatchId: ids.dispatch! }))).toEqual({
      skipped: 'alreadyFinished',
    });
    // 模擬寫到一半當掉後重試
    await db
      .update(announcementDispatches)
      .set({ status: 'sending' })
      .where(eq(announcementDispatches.id, ids.dispatch!));
    const report = await inTestTenant(app, () => service.fanOut({ dispatchId: ids.dispatch! }));
    // 受眾解析出 4 人（含送出者自己），寫入時略過自己（docs/architecture/backend/15-notification.md §12.2 D7），已寫的 3 人不重複
    expect(report).toEqual({ recipients: 4, written: 0, revoked: false });
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.sourceId, ids.dispatch!));
    expect(rows).toHaveLength(3);
  });

  it('收件人讀全文 → 標為已讀、已讀數 +1；沒收到的人 404', async () => {
    const message = dataOf<{ title: string; body: string; sender: { id: string } | null }>(
      await (await as(M1)).get(`/me/announcement-messages/${ids.dispatch}`).expect(200),
    );
    expect(message).toMatchObject({
      title: '系統維護通知',
      body: '本週六 22:00～24:00 系統維護，請提前存檔。',
      sender: { id: ids.root },
    });
    const [row] = await db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.sourceId, ids.dispatch!), eq(notifications.recipientId, ids.m1!)),
      );
    expect(row!.readAt).not.toBeNull();
    const [dispatch] = await dispatchesOf(ids.immediate!);
    expect(dispatch!.readCount).toBe(1);

    const response = await (
      await as(AUDITOR)
    )
      .get(`/me/announcement-messages/${ids.dispatch}`)
      .expect(404);
    expect(errorOf(response).code).toBe('ANNOUNCEMENT_MESSAGE_NOT_FOUND');
  });

  it('已完成的公告不能再編輯 → 409 ANNOUNCEMENT_INVALID_STATE', async () => {
    const root = await as(ROOT);
    const current = dataOf<AnnouncementBody>(await root.get(`/announcements/${ids.immediate}`));
    const response = await root
      .patch(`/announcements/${ids.immediate}`, { title: '改標題', version: current.version })
      .expect(409);
    expect(errorOf(response)).toMatchObject({
      code: 'ANNOUNCEMENT_INVALID_STATE',
      details: { status: 'completed' },
    });
  });

  it('撤回：通知全部刪除、發送紀錄保留為 revoked、寫稽核；收件人讀全文 404；再撤回 409', async () => {
    const root = await as(ROOT);
    const revoked = dataOf<DispatchBody>(
      await root
        .post(`/announcements/${ids.immediate}/dispatches/${ids.dispatch}/revoke`)
        .expect(200),
    );
    expect(revoked).toMatchObject({ status: 'revoked', recipientCount: 3 });
    expect(
      await db.select().from(notifications).where(eq(notifications.sourceId, ids.dispatch!)),
    ).toHaveLength(0);
    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'announcementDispatch.revoke'));
    expect(audit?.metadata).toMatchObject({ dispatchId: ids.dispatch });

    await (await as(M1)).get(`/me/announcement-messages/${ids.dispatch}`).expect(404);
    const again = await root
      .post(`/announcements/${ids.immediate}/dispatches/${ids.dispatch}/revoke`)
      .expect(409);
    expect(errorOf(again).code).toBe('ANNOUNCEMENT_DISPATCH_NOT_REVOCABLE');
  });

  // ── 指定時間 ─────────────────────────────────────────

  it('指定的時間已經過去 → 400 ANNOUNCEMENT_TRIGGER_IN_PAST', async () => {
    const root = await as(ROOT);
    const past = dataOf<AnnouncementBody>(
      await root
        .post('/announcements', draft({ trigger: { kind: 'once', at: '2020-01-01T00:00:00Z' } }))
        .expect(201),
    );
    const response = await root
      .post(`/announcements/${past.id}/publish`, { version: 1 })
      .expect(400);
    expect(errorOf(response).code).toBe('ANNOUNCEMENT_TRIGGER_IN_PAST');
  });

  it('排程：送出 → scheduled（延遲工作在交易內入列）；編輯者不能改排程中的公告；暫停 → 恢復 → 時間到發送', async () => {
    const root = await as(ROOT);
    const at = new Date(Date.now() + 4000).toISOString();
    const created = dataOf<AnnouncementBody>(
      await root
        .post('/announcements', draft({ title: '排程公告', trigger: { kind: 'once', at } }))
        .expect(201),
    );
    const scheduled = dataOf<AnnouncementBody>(
      await root.post(`/announcements/${created.id}/publish`, { version: 1 }).expect(200),
    );
    expect(scheduled).toMatchObject({ status: 'scheduled', nextRunAt: at });

    const editorPatch = await (
      await as(EDITOR)
    )
      .patch(`/announcements/${created.id}`, { title: '偷改', version: scheduled.version })
      .expect(403);
    expect(errorOf(editorPatch)).toMatchObject({
      code: 'AUTHZ_FORBIDDEN',
      details: { missing: ['announcement:publish'] },
    });

    const paused = dataOf<AnnouncementBody>(
      await root
        .post(`/announcements/${created.id}/pause`, { version: scheduled.version })
        .expect(200),
    );
    expect(paused).toMatchObject({ status: 'paused', nextRunAt: null });
    const resumed = dataOf<AnnouncementBody>(
      await root
        .post(`/announcements/${created.id}/resume`, { version: paused.version })
        .expect(200),
    );
    expect(resumed).toMatchObject({ status: 'scheduled', nextRunAt: at });

    const dispatch = await waitForDispatch(created.id, 'sent');
    expect(dispatch.recipientCount).toBe(3);
    const done = dataOf<AnnouncementBody>(await root.get(`/announcements/${created.id}`));
    expect(done).toMatchObject({ status: 'completed', nextRunAt: null });
    // 暫停前入列的那一筆與恢復時入列的時間相同：先執行的發送並完成，後執行的看到已完成就略過
    expect(await dispatchesOf(created.id)).toHaveLength(1);
  });

  it('排程中改了時間：舊的延遲工作變成 no-op；刪除 → 暫停並進回收桶；還原後仍是暫停', async () => {
    const root = await as(ROOT);
    const soon = new Date(Date.now() + 2000).toISOString();
    const created = dataOf<AnnouncementBody>(
      await root
        .post('/announcements', draft({ title: '改時間', trigger: { kind: 'once', at: soon } }))
        .expect(201),
    );
    const scheduled = dataOf<AnnouncementBody>(
      await root.post(`/announcements/${created.id}/publish`, { version: 1 }).expect(200),
    );
    const later = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const moved = dataOf<AnnouncementBody>(
      await root
        .patch(`/announcements/${created.id}`, {
          trigger: { kind: 'once', at: later },
          version: scheduled.version,
        })
        .expect(200),
    );
    expect(moved).toMatchObject({ status: 'scheduled', nextRunAt: later });
    const outbox = await db.select().from(jobOutbox);
    expect(outbox).toEqual([]); // 提交後已搬進佇列

    // 舊的工作到時間執行：時間對不上 → 不發送（工作的 output 是 { skipped: 'stale' }）
    await vi.waitFor(
      async () => {
        const jobs = dataOf<{ items: Array<{ id: string; state: string; createdOn: string }> }>(
          await root.get('/jobs?name=announcement.dispatch&state=completed').expect(200),
        ).items;
        const outputs = await Promise.all(
          jobs.map(async (job) =>
            dataOf<{ data: { runAt?: string }; output: unknown }>(
              await root.get(`/jobs/${job.id}`).expect(200),
            ),
          ),
        );
        expect(outputs.find((job) => job.data.runAt === soon)?.output).toEqual({
          skipped: 'stale',
        });
      },
      { timeout: 20_000, interval: 500 },
    );
    expect(await dispatchesOf(created.id)).toHaveLength(0);

    await root.delete(`/announcements/${created.id}`).expect(204);
    const [deleted] = await db.select().from(announcements).where(eq(announcements.id, created.id));
    expect(deleted).toMatchObject({ status: 'paused', nextRunAt: null });
    const trash = dataOf<{ items: Array<{ id: string }> }>(
      await root.get('/trash?type=announcement').expect(200),
    );
    expect(trash.items.map((item) => item.id)).toContain(created.id);

    const restored = dataOf<AnnouncementBody>(
      await root.post(`/announcements/${created.id}/restore`).expect(200),
    );
    expect(restored.status).toBe('paused');
  });

  // ── 週期（A3） ───────────────────────────────────────

  it('週期預覽：依租戶時區回接下來 5 次；週期少了星期幾 → 400', async () => {
    const root = await as(ROOT);
    const preview = dataOf<{ timeZone: string; occurrences: string[] }>(
      await root
        .post('/announcements/recurrence-preview', {
          trigger: {
            kind: 'recurring',
            frequency: 'daily',
            interval: 1,
            time: '09:00',
            startsOn: '2030-01-01',
            maxOccurrences: 3,
          },
        })
        .expect(200),
    );
    // 預設時區 Asia/Taipei（UTC+8）
    expect(preview).toEqual({
      timeZone: 'Asia/Taipei',
      occurrences: [
        '2030-01-01T01:00:00.000Z',
        '2030-01-02T01:00:00.000Z',
        '2030-01-03T01:00:00.000Z',
      ],
    });
    await root
      .post('/announcements/recurrence-preview', {
        trigger: {
          kind: 'recurring',
          frequency: 'weekly',
          interval: 1,
          time: '09:00',
          startsOn: '2030-01-01',
        },
      })
      .expect(400);
  });

  it('週期：送出 → 排程到第一次；時間到發送後排下一次，次數用完就完成', async () => {
    const root = await as(ROOT);
    const created = dataOf<AnnouncementBody>(
      await root
        .post(
          '/announcements',
          draft({
            title: '每日提醒',
            trigger: {
              kind: 'recurring',
              frequency: 'daily',
              interval: 1,
              time: '09:00',
              startsOn: '2030-01-01',
              maxOccurrences: 2,
            },
          }),
        )
        .expect(201),
    );
    const scheduled = dataOf<AnnouncementBody>(
      await root.post(`/announcements/${created.id}/publish`, { version: 1 }).expect(200),
    );
    expect(scheduled).toMatchObject({ status: 'scheduled', nextRunAt: '2030-01-01T01:00:00.000Z' });

    // 直接執行排程的工作（時間在很久以後，不等 worker）
    const service = app.get(AnnouncementDispatchService);
    const first = await inTestTenant(app, () =>
      service.runScheduled({ announcementId: created.id, runAt: '2030-01-01T01:00:00.000Z' }),
    );
    expect(first).toHaveProperty('dispatchId');
    const afterFirst = dataOf<AnnouncementBody>(await root.get(`/announcements/${created.id}`));
    expect(afterFirst).toMatchObject({
      status: 'scheduled',
      nextRunAt: '2030-01-02T01:00:00.000Z',
    });

    // 同一個時間的舊工作再跑一次：時間對不上，不重複發
    expect(
      await inTestTenant(app, () =>
        service.runScheduled({ announcementId: created.id, runAt: '2030-01-01T01:00:00.000Z' }),
      ),
    ).toEqual({ skipped: 'stale' });

    await inTestTenant(app, () =>
      service.runScheduled({ announcementId: created.id, runAt: '2030-01-02T01:00:00.000Z' }),
    );
    const done = dataOf<AnnouncementBody>(await root.get(`/announcements/${created.id}`));
    expect(done).toMatchObject({ status: 'completed', nextRunAt: null });
    expect(await dispatchesOf(created.id)).toHaveLength(2);
  });

  it('每日維護：改了租戶時區 → 週期重算下一次；過期的發送紀錄刪除，未結束的保留', async () => {
    const root = await as(ROOT);
    const created = dataOf<AnnouncementBody>(
      await root
        .post(
          '/announcements',
          draft({
            title: '時區',
            trigger: {
              kind: 'recurring',
              frequency: 'weekly',
              interval: 1,
              weekdays: [1],
              time: '09:00',
              startsOn: '2030-01-01',
            },
          }),
        )
        .expect(201),
    );
    const scheduled = dataOf<AnnouncementBody>(
      await root.post(`/announcements/${created.id}/publish`, { version: 1 }).expect(200),
    );
    // 2030-01-07 是週一：台北 09:00
    expect(scheduled.nextRunAt).toBe('2030-01-07T01:00:00.000Z');

    await root
      .patch('/system/settings', { values: { 'general.defaultTimezone': 'UTC' } })
      .expect(200);

    // 一筆過期已結束、一筆過期但還在等待（不刪）
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    const [expired, waiting] = await db
      .insert(announcementDispatches)
      .values([
        {
          announcementId: created.id,
          scheduledFor: new Date('2020-01-01T00:00:00Z'),
          title: 't',
          body: 'b',
          audience: { all: true, userIds: [], groupIds: [], roleIds: [] },
          status: 'sent',
          createdAt: old,
        },
        {
          announcementId: created.id,
          scheduledFor: new Date('2020-01-02T00:00:00Z'),
          title: 't',
          body: 'b',
          audience: { all: true, userIds: [], groupIds: [], roleIds: [] },
          status: 'pending',
          createdAt: old,
        },
      ])
      .returning();

    const report = await inTestTenant(app, () => app.get(AnnouncementDispatchService).maintain());
    expect(report).toMatchObject({ retentionDays: 365, deletedDispatches: 1 });
    const moved = dataOf<AnnouncementBody>(await root.get(`/announcements/${created.id}`));
    expect(moved.nextRunAt).toBe('2030-01-07T09:00:00.000Z');
    const left = await db
      .select({ id: announcementDispatches.id })
      .from(announcementDispatches)
      .where(inArray(announcementDispatches.id, [expired!.id, waiting!.id]));
    expect(left.map((row) => row.id)).toEqual([waiting!.id]);

    await root
      .patch('/system/settings', { values: { 'general.defaultTimezone': null } })
      .expect(200);
  });

  // ── 事件點（A4） ─────────────────────────────────────

  it('可以訂的觸發點：使用者啟用、被指派角色、加入群組；不在目錄上的事件 → 400', async () => {
    const root = await as(ROOT);
    const listed = dataOf<{ items: Array<{ event: string; scope: string }> }>(
      await root.get('/announcements/trigger-events').expect(200),
    );
    expect(listed.items).toEqual(
      expect.arrayContaining([
        { event: 'user.activated', scope: 'audience' },
        { event: 'user.roleAssigned', scope: 'role' },
        { event: 'group.memberAdded', scope: 'group' },
      ]),
    );
    const response = await root
      .post(
        '/announcements',
        draft({ trigger: { kind: 'event', event: 'nope.happened', delayMinutes: 0 } }),
      )
      .expect(400);
    expect(errorOf(response)).toMatchObject({
      code: 'ANNOUNCEMENT_EVENT_UNKNOWN',
      details: { event: 'nope.happened' },
    });
  });

  it('group.memberAdded：送出後排程中但沒有下一次；加入受眾裡的群組 → 只發給他、只發一次；加入其他群組不發', async () => {
    const root = await as(ROOT);
    const [welcome, other] = await db
      .insert(groups)
      .values([{ name: '公告-新人' }, { name: '公告-其他' }])
      .returning();
    const created = dataOf<AnnouncementBody>(
      await root
        .post(
          '/announcements',
          draft({
            title: '歡迎加入',
            audience: { groupIds: [welcome!.id] },
            trigger: { kind: 'event', event: 'group.memberAdded', delayMinutes: 0 },
          }),
        )
        .expect(201),
    );
    const scheduled = dataOf<AnnouncementBody>(
      await root.post(`/announcements/${created.id}/publish`, { version: 1 }).expect(200),
    );
    expect(scheduled).toMatchObject({ status: 'scheduled', nextRunAt: null });

    const addMember = (groupId: string, userId: string) =>
      root
        .patch(`/groups/${groupId}/members`, { add: [{ type: 'user', id: userId }], remove: [] })
        .expect(200);
    const removeMember = (groupId: string, userId: string) =>
      root
        .patch(`/groups/${groupId}/members`, { add: [], remove: [{ type: 'user', id: userId }] })
        .expect(200);

    await addMember(other!.id, ids.m1!);
    await addMember(welcome!.id, ids.m3!);
    const dispatch = await waitForDispatch(created.id, 'sent');
    expect(dispatch.recipientCount).toBe(1);
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.sourceId, dispatch.id));
    expect(rows.map((row) => row.recipientId)).toEqual([ids.m3]);

    // 移出又加回：同一個人只發一次（D13）；等工作跑完
    await removeMember(welcome!.id, ids.m3!);
    await addMember(welcome!.id, ids.m3!);
    await vi.waitFor(
      async () => {
        const jobs = dataOf<{ items: Array<{ state: string }> }>(
          await root.get('/jobs?name=announcement.eventDispatch').expect(200),
        ).items;
        expect(jobs.length).toBeGreaterThanOrEqual(2);
        expect(jobs.every((job) => job.state === 'completed')).toBe(true);
      },
      { timeout: 20_000, interval: 250 },
    );
    expect(await dispatchesOf(created.id)).toHaveLength(1);
  });

  it('user.roleAssigned：被指派受眾裡的角色才發；user.activated：建立就能登入的帳號在受眾裡就發', async () => {
    const root = await as(ROOT);
    const roleAnnouncement = dataOf<AnnouncementBody>(
      await root
        .post(
          '/announcements',
          draft({
            title: '成為公告收件人',
            audience: { roleIds: [ids.role] },
            trigger: { kind: 'event', event: 'user.roleAssigned', delayMinutes: 0 },
          }),
        )
        .expect(201),
    );
    await root.post(`/announcements/${roleAnnouncement.id}/publish`, { version: 1 }).expect(200);
    await root
      .put(`/users/${ids.m2}/roles`, { roleIds: [ids.role], expectedRoleIds: [] })
      .expect(200);
    const roleDispatch = await waitForDispatch(roleAnnouncement.id, 'sent');
    expect(roleDispatch.audience).toMatchObject({ userIds: [ids.m2] });

    const welcome = dataOf<AnnouncementBody>(
      await root
        .post(
          '/announcements',
          draft({
            title: '新手指南',
            audience: { all: true },
            trigger: { kind: 'event', event: 'user.activated', delayMinutes: 0 },
          }),
        )
        .expect(201),
    );
    await root.post(`/announcements/${welcome.id}/publish`, { version: 1 }).expect(200);
    const tenantDb = app.get<Database>(TENANT_DB);
    const newcomer = await inTestTenant(app, () =>
      withTransaction(tenantDb, (tx) =>
        app.get(UserAccountService).createAccount(
          {
            email: 'an-newcomer@example.com',
            displayName: '新人',
            status: 'active',
            roleIds: [],
          },
          null,
          tx,
        ),
      ),
    );
    const welcomeDispatch = await waitForDispatch(welcome.id, 'sent');
    expect(welcomeDispatch.audience).toMatchObject({ userIds: [newcomer.id] });
  });

  it('樂觀鎖：送出過時的 version → 409 ANNOUNCEMENT_VERSION_CONFLICT（details.current）', async () => {
    const root = await as(ROOT);
    const created = dataOf<AnnouncementBody>(
      await root.post('/announcements', draft()).expect(201),
    );
    await root.patch(`/announcements/${created.id}`, { title: '第一次', version: 1 }).expect(200);
    const response = await root
      .patch(`/announcements/${created.id}`, { title: '第二次', version: 1 })
      .expect(409);
    expect(errorOf(response)).toMatchObject({
      code: 'ANNOUNCEMENT_VERSION_CONFLICT',
      details: { current: 2 },
    });
  });

  it('事件目錄：announcement.published 預設不允許個人關閉（D16）', async () => {
    const events = dataOf<{
      items: Array<{ type: string; channels: Array<{ allowUserOverride: boolean }> }>;
    }>(await (await as(ROOT)).get('/notification-events').expect(200));
    const announcement = events.items.find((item) => item.type === 'announcement.published');
    expect(announcement?.channels).toEqual([expect.objectContaining({ allowUserOverride: false })]);
  });

  it('所有發送都寫了稽核的 publish（立即與排程各一）', async () => {
    const rows = await db
      .select()
      .from(auditLogs)
      .where(
        inArray(auditLogs.action, [
          'announcement.publish',
          'announcement.pause',
          'announcement.resume',
        ]),
      );
    expect(
      rows.filter((row) => row.action === 'announcement.publish').length,
    ).toBeGreaterThanOrEqual(2);
    expect(rows.some((row) => row.action === 'announcement.pause')).toBe(true);
    expect(rows.some((row) => row.action === 'announcement.resume')).toBe(true);
  });

  // 放在最後：這裡新增的帳號會成為之後「全租戶」受眾的收件人
  it('事件點的 audience 比對只判斷一個人（includes）：與解析整個受眾的結果一致——巢狀群組、群組持有的角色、已刪除的群組或角色、停用的人', async () => {
    // G1 ⊃ G2（m1、m2、停用的 m4）與角色 R（m3）沿用上面的設定；另外：
    // G3 持有角色 R2、m5 是 G3 的成員；已刪除的群組 G4 有成員 m6；已刪除的角色 R3 由 m7 持有
    const m5 = await createUser({ email: 'an-m5@example.com' });
    const m6 = await createUser({ email: 'an-m6@example.com' });
    const m7 = await createUser({ email: 'an-m7@example.com' });
    const [g3, g4] = await db
      .insert(groups)
      .values([{ name: '公告-持有角色' }, { name: '公告-已刪除', deletedAt: new Date() }])
      .returning();
    const [r2, r3] = await db
      .insert(roles)
      .values([
        { slug: 'announcement-held-by-group', name: '群組持有', isSystem: false },
        { slug: 'announcement-deleted', name: '已刪除', isSystem: false, deletedAt: new Date() },
      ])
      .returning();
    await db
      .insert(relationTuples)
      .values([
        groupRoleTuple(r2!.id, g3!.id),
        groupMemberTuple(g3!.id, { type: 'user', id: m5 }),
        groupMemberTuple(g4!.id, { type: 'user', id: m6 }),
        roleHolderTuple(r3!.id, m7),
      ]);

    const audience = {
      all: false,
      userIds: [],
      groupIds: [ids.g1!, g4!.id],
      roleIds: [ids.role!, r2!.id, r3!.id],
    };
    const resolver = app.get(AnnouncementAudienceResolver);
    const resolved = await inTestTenant(app, () => resolver.resolve(audience));
    // m1（G1）、m2（G1 ⊃ G2）、m3（角色 R）、m5（G3 持有 R2）；m4 停用、m6 在已刪除的群組、m7 持有已刪除的角色
    expect(new Set(resolved.userIds)).toEqual(new Set([ids.m1, ids.m2, ids.m3, m5]));

    const candidates = [ids.m1!, ids.m2!, ids.m3!, ids.m4!, m5, m6, m7, ids.root!];
    const included = await Promise.all(
      candidates.map((userId) => inTestTenant(app, () => resolver.includes(audience, userId))),
    );
    expect(included).toEqual(candidates.map((userId) => resolved.userIds.includes(userId)));
  });
});
