import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { JobQueue } from '@/core/jobs';
import {
  auditLogs,
  notificationPolicies,
  notificationPreferences,
  notifications,
  relationTuples,
  roleHolderTuple,
  roles,
  users,
} from '@/db/schema';
import { ApprovalService } from '@/modules/approval/approval.service';
import { userRegistrationRequest } from '@/modules/user/user-registration.approval';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { inTestTenant, testTenantContext } from './tenant';

const JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
const SUPER_ADMIN_EMAIL = 'events-root@example.com';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;
let jwt: JwtService;
let tenantId: string;
let rootId: string;

async function roleIdOf(slug: string): Promise<string> {
  const [role] = await db.select().from(roles).where(eq(roles.slug, slug));
  return role!.id;
}

async function createUser(email: string, roleSlugs: string[] = []): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ email, displayName: `顯示 ${email}`, status: 'active' })
    .returning();
  for (const slug of roleSlugs) {
    // oxlint-disable-next-line no-await-in-loop -- 前置資料，角色數很少
    await db.insert(relationTuples).values(roleHolderTuple(await roleIdOf(slug), user!.id));
  }
  return user!.id;
}

/** 直接簽 access token：登入端點有速率限制，這裡要測的不是登入。 */
async function auth(userId: string): Promise<{ Authorization: string }> {
  const token = await jwt.signAsync(
    { sub: userId, ver: 0, jti: randomUUID(), tid: tenantId },
    { secret: JWT_SECRET, expiresIn: 300 },
  );
  return { Authorization: `Bearer ${token}` };
}

interface ChannelBody {
  channel: string;
  enabled: boolean;
  defaultEnabled: boolean;
  isOverridden: boolean;
  allowUserOverride: boolean;
  updatedAt: string | null;
}

interface EventBody {
  type: string;
  category: string;
  mandatory: boolean;
  channels: ChannelBody[];
}

function eventOf(body: unknown, type: string): EventBody | undefined {
  return (body as { data: { items: EventBody[] } }).data.items.find((item) => item.type === type);
}

async function patchAsRoot(changes: unknown[], status = 200) {
  return request(http)
    .patch('/notification-events')
    .set(await auth(rootId))
    .send({ changes })
    .expect(status);
}

function notificationsOf(recipientId: string, type: string) {
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.recipientId, recipientId), eq(notifications.type, type)));
}

/** 以 `requester` 的身分送出一筆註冊推薦（審核後的結果通知給他）。 */
async function submitAs(requester: string, email: string) {
  return inTestTenant(app, () =>
    app.get(ApprovalService).submit({
      ...userRegistrationRequest({ email, displayName: email }, 'hash'),
      requester: { id: requester, name: email },
    }),
  );
}

describe('事件管理（docs/architecture/backend/16-notification-event.md、docs/architecture/backend/16-notification-event.md §9）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN_EMAIL;
    process.env.SUPER_ADMIN_PASSWORD = 'EventsRoot!2026';

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);

    const { AppModule } = await import('@/app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    http = await listenOnLoopback(app);
    jwt = app.get(JwtService);
    tenantId = (await testTenantContext(app)).id;
    const [root] = await db.select().from(users).where(eq(users.email, SUPER_ADMIN_EMAIL));
    rootId = root!.id;
  });

  afterAll(async () => {
    await app?.close();
    await closeDb?.();
  });

  beforeEach(async () => {
    await db.delete(notificationPreferences);
    // 每個案例從預設開始：直接清表時要繞過快取，所以經由 API 還原
    const rows = await db.select().from(notificationPolicies);
    if (rows.length) {
      await patchAsRoot(
        rows.map((row) => ({
          type: row.type,
          channel: row.channel,
          enabled: null,
          allowUserOverride: true,
        })),
      );
    }
  });

  describe('授權（docs/architecture/backend/16-notification-event.md §9.2 D10）', () => {
    it('未登入 → 401；沒有 system:read → 403；system:read 只能讀、PATCH 要 system:update', async () => {
      const member = await createUser('events-member@example.com', ['member']);
      const auditor = await createUser('events-auditor@example.com', ['auditor']);

      await request(http).get('/notification-events').expect(401);
      await request(http)
        .get('/notification-events')
        .set(await auth(member))
        .expect(403);
      await request(http)
        .get('/notification-events')
        .set(await auth(auditor))
        .expect(200);
      await request(http)
        .patch('/notification-events')
        .set(await auth(auditor))
        .send({ changes: [{ type: 'approval.pending', channel: 'inApp', enabled: false }] })
        .expect(403);
    });
  });

  describe('GET /notification-events（D9）', () => {
    it('列出已登記的事件與管道，沒有覆寫時都是預設值', async () => {
      const response = await request(http)
        .get('/notification-events')
        .set(await auth(rootId))
        .expect(200);
      const types = (response.body as { data: { items: EventBody[] } }).data.items.map(
        (item) => item.type,
      );
      expect(types).toEqual(
        expect.arrayContaining(['approval.pending', 'approval.result', 'user.rolesChanged']),
      );
      expect(eventOf(response.body, 'approval.result')).toEqual({
        type: 'approval.result',
        category: 'approval',
        mandatory: false,
        channels: [
          {
            channel: 'inApp',
            enabled: true,
            defaultEnabled: true,
            isOverridden: false,
            allowUserOverride: true,
            updatedAt: null,
          },
          {
            channel: 'email',
            enabled: true,
            defaultEnabled: true,
            isOverridden: false,
            allowUserOverride: true,
            updatedAt: null,
          },
        ],
      });
    });
  });

  describe('PATCH /notification-events（D9）', () => {
    it('關閉後回傳生效值、寫一列覆寫與一筆稽核；還原預設刪掉那一列', async () => {
      const closed = await patchAsRoot([
        { type: 'approval.result', channel: 'email', enabled: false },
      ]);
      expect(eventOf(closed.body, 'approval.result')?.channels[1]).toMatchObject({
        channel: 'email',
        enabled: false,
        isOverridden: true,
        updatedAt: expect.any(String),
      });
      expect(await db.select().from(notificationPolicies)).toEqual([
        expect.objectContaining({
          type: 'approval.result',
          channel: 'email',
          enabled: false,
          updatedBy: rootId,
        }),
      ]);
      const [audit] = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'notificationPolicy.update'));
      expect(audit).toMatchObject({
        actorId: rootId,
        resourceType: 'notificationPolicy',
        resourceName: 'approval.result:email',
        changes: {
          before: { 'approval.result:email': { enabled: true, allowUserOverride: true } },
          after: { 'approval.result:email': { enabled: false, allowUserOverride: true } },
        },
      });

      const restored = await patchAsRoot([
        { type: 'approval.result', channel: 'email', enabled: null },
      ]);
      expect(eventOf(restored.body, 'approval.result')?.channels[1]).toMatchObject({
        enabled: true,
        isOverridden: false,
        updatedAt: null,
      });
      expect(await db.select().from(notificationPolicies)).toEqual([]);
    });

    // 預設不允許個人調整的事件（announcement.published，docs/architecture/backend/19-announcement.md §9 D16）：
    // 「允許」才是覆寫值，`enabled` 跟著預設（null）也要存得進去；改回預設就刪掉那一列
    it('預設不允許個人調整的事件改成允許 → 存成覆寫；改回預設刪掉那一列', async () => {
      const allowed = await patchAsRoot([
        { type: 'announcement.published', channel: 'inApp', allowUserOverride: true },
      ]);
      expect(eventOf(allowed.body, 'announcement.published')?.channels[0]).toMatchObject({
        enabled: true,
        isOverridden: false,
        allowUserOverride: true,
      });
      expect(
        await db
          .select()
          .from(notificationPolicies)
          .where(eq(notificationPolicies.type, 'announcement.published')),
      ).toEqual([
        expect.objectContaining({ channel: 'inApp', enabled: null, allowUserOverride: true }),
      ]);

      await patchAsRoot([
        { type: 'announcement.published', channel: 'inApp', allowUserOverride: false },
      ]);
      expect(
        await db
          .select()
          .from(notificationPolicies)
          .where(eq(notificationPolicies.type, 'announcement.published')),
      ).toEqual([]);
    });

    it('沒有登記的事件、不支援的管道 → 404 NOTIFICATION_EVENT_NOT_FOUND，什麼都不寫', async () => {
      for (const change of [
        { type: 'sample.unknown', channel: 'inApp', enabled: false },
        { type: 'approval.pending', channel: 'email', enabled: false },
      ]) {
        // oxlint-disable-next-line no-await-in-loop -- 逐一斷言每一種拒絕
        const response = await patchAsRoot(
          [{ type: 'user.rolesChanged', channel: 'inApp', enabled: false }, change],
          404,
        );
        expect(response.body).toMatchObject({
          error: {
            code: 'NOTIFICATION_EVENT_NOT_FOUND',
            details: { type: change.type, channel: change.channel },
          },
        });
      }
      expect(await db.select().from(notificationPolicies)).toEqual([]);
    });

    it('格式不對（空的、重複的事件與管道、不認得的管道）→ 400 VALIDATION_FAILED', async () => {
      await patchAsRoot([], 400);
      await patchAsRoot(
        [
          { type: 'approval.pending', channel: 'inApp', enabled: false },
          { type: 'approval.pending', channel: 'inApp', enabled: true },
        ],
        400,
      );
      await patchAsRoot([{ type: 'approval.pending', channel: 'sms', enabled: false }], 400);
    });
  });

  describe('送達（D6）', () => {
    it('關掉 approval.pending 的站內通知 → 送出申請時審核者收不到；打開後恢復，關閉期間的不補發（D7）', async () => {
      const reviewer = await createUser('events-reviewer@example.com', ['admin']);
      await patchAsRoot([{ type: 'approval.pending', channel: 'inApp', enabled: false }]);

      await request(http)
        .post('/auth/register')
        .send({
          email: 'events-newcomer-1@example.com',
          displayName: '申請人甲',
          password: 'ApplicantPassword!2026',
        })
        .expect(202);
      expect(await notificationsOf(reviewer, 'approval.pending')).toEqual([]);

      await patchAsRoot([{ type: 'approval.pending', channel: 'inApp', enabled: null }]);
      await request(http)
        .post('/auth/register')
        .send({
          email: 'events-newcomer-2@example.com',
          displayName: '申請人乙',
          password: 'ApplicantPassword!2026',
        })
        .expect(202);
      expect(await notificationsOf(reviewer, 'approval.pending')).toEqual([
        expect.objectContaining({ params: expect.objectContaining({ subject: '申請人乙' }) }),
      ]);
    });

    it('關掉 approval.result 的 email → 駁回時不入列結果信，站內通知照常', async () => {
      const requester = await createUser('events-requester@example.com', ['admin']);
      const reviewer = await createUser('events-other-reviewer@example.com', ['admin']);
      const created = await inTestTenant(app, () =>
        app.get(ApprovalService).submit({
          ...userRegistrationRequest(
            { email: 'events-invited@example.com', displayName: '被推薦的人' },
            'hash',
          ),
          requester: { id: requester, name: 'events-requester@example.com' },
        }),
      );
      await patchAsRoot([{ type: 'approval.result', channel: 'email', enabled: false }]);
      const enqueue = vi.spyOn(app.get(JobQueue), 'enqueue');

      await request(http)
        .post(`/approvals/${created!.id}/reject`)
        .set(await auth(reviewer))
        .send({ comment: '不需要' })
        .expect(200);

      expect(enqueue).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: 'approval.resultMail' }),
        expect.anything(),
        expect.anything(),
      );
      expect(await notificationsOf(requester, 'approval.result')).toHaveLength(1);
      enqueue.mockRestore();
    });
  });

  describe('個人設定（docs/architecture/backend/16-notification-event.md §9.2 D14、D15）', () => {
    interface PreferenceChannelBody {
      channel: string;
      enabled: boolean;
      isOverridden: boolean;
      lock: string | null;
    }

    function preferenceOf(body: unknown, type: string, channel: string) {
      return (
        body as { data: { items: Array<{ type: string; channels: PreferenceChannelBody[] }> } }
      ).data.items
        .find((item) => item.type === type)
        ?.channels.find((item) => item.channel === channel);
    }

    it('未登入 → 401；登入就能讀自己的，沒有覆寫時跟著租戶、可以調整', async () => {
      const member = await createUser('pref-reader@example.com', ['member']);
      await request(http).get('/me/notification-preferences').expect(401);
      const response = await request(http)
        .get('/me/notification-preferences')
        .set(await auth(member))
        .expect(200);
      expect(preferenceOf(response.body, 'approval.result', 'email')).toEqual({
        channel: 'email',
        enabled: true,
        isOverridden: false,
        lock: null,
      });
    });

    it('自己關掉 approval.result → 駁回後收不到站內通知、不入列結果信；別人不受影響', async () => {
      const requester = await createUser('pref-requester@example.com', ['member']);
      const reviewer = await createUser('pref-reviewer@example.com', ['admin']);
      const patched = await request(http)
        .patch('/me/notification-preferences')
        .set(await auth(requester))
        .send({
          changes: [
            { type: 'approval.result', channel: 'inApp', enabled: false },
            { type: 'approval.result', channel: 'email', enabled: false },
          ],
        })
        .expect(200);
      expect(preferenceOf(patched.body, 'approval.result', 'inApp')).toMatchObject({
        enabled: false,
        isOverridden: true,
      });
      expect(await db.select().from(notificationPreferences)).toHaveLength(2);
      // 個人設定不寫稽核
      expect(await db.select().from(auditLogs).where(eq(auditLogs.actorId, requester))).toEqual([]);

      const created = await submitAs(requester, 'pref-invitee@example.com');
      const enqueue = vi.spyOn(app.get(JobQueue), 'enqueue');
      await request(http)
        .post(`/approvals/${created!.id}/reject`)
        .set(await auth(reviewer))
        .send({})
        .expect(200);
      expect(await notificationsOf(requester, 'approval.result')).toEqual([]);
      expect(enqueue).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: 'approval.resultMail' }),
        expect.anything(),
        expect.anything(),
      );
      enqueue.mockRestore();

      // 另一位申請人沒有關，照常收到
      const other = await createUser('pref-other-requester@example.com', ['member']);
      const second = await submitAs(other, 'pref-invitee-2@example.com');
      await request(http)
        .post(`/approvals/${second!.id}/reject`)
        .set(await auth(reviewer))
        .send({})
        .expect(200);
      expect(await notificationsOf(other, 'approval.result')).toHaveLength(1);
    });

    it('租戶不允許個人調整 → 顯示 tenantRequired、PATCH 409；之前關掉的人也照樣收到', async () => {
      const requester = await createUser('pref-required@example.com', ['member']);
      const reviewer = await createUser('pref-required-reviewer@example.com', ['admin']);
      await request(http)
        .patch('/me/notification-preferences')
        .set(await auth(requester))
        .send({ changes: [{ type: 'approval.result', channel: 'inApp', enabled: false }] })
        .expect(200);
      const admin = await patchAsRoot([
        { type: 'approval.result', channel: 'inApp', allowUserOverride: false },
      ]);
      expect(eventOf(admin.body, 'approval.result')?.channels[0]).toMatchObject({
        enabled: true,
        isOverridden: false,
        allowUserOverride: false,
      });

      const mine = await request(http)
        .get('/me/notification-preferences')
        .set(await auth(requester))
        .expect(200);
      expect(preferenceOf(mine.body, 'approval.result', 'inApp')).toEqual({
        channel: 'inApp',
        enabled: true,
        isOverridden: false,
        lock: 'tenantRequired',
      });
      const rejected = await request(http)
        .patch('/me/notification-preferences')
        .set(await auth(requester))
        .send({ changes: [{ type: 'approval.result', channel: 'inApp', enabled: false }] })
        .expect(409);
      expect(rejected.body).toMatchObject({
        error: {
          code: 'NOTIFICATION_PREFERENCE_LOCKED',
          details: { type: 'approval.result', channel: 'inApp', lock: 'tenantRequired' },
        },
      });

      const created = await submitAs(requester, 'pref-required-invitee@example.com');
      await request(http)
        .post(`/approvals/${created!.id}/reject`)
        .set(await auth(reviewer))
        .send({})
        .expect(200);
      expect(await notificationsOf(requester, 'approval.result')).toHaveLength(1);
    });

    it('租戶關掉 → 個人顯示 tenantDisabled、不能打開', async () => {
      const member = await createUser('pref-disabled@example.com', ['member']);
      await patchAsRoot([{ type: 'user.rolesChanged', channel: 'inApp', enabled: false }]);
      await request(http)
        .patch('/me/notification-preferences')
        .set(await auth(member))
        .send({ changes: [{ type: 'user.rolesChanged', channel: 'inApp', enabled: true }] })
        .expect(409);
    });

    it('DB 約束：使用者被永久刪除時個人設定一起刪', async () => {
      const member = await createUser('pref-purged@example.com', ['member']);
      await db
        .insert(notificationPreferences)
        .values({ userId: member, type: 'approval.result', channel: 'inApp', enabled: false });
      await db.delete(relationTuples).where(eq(relationTuples.subjectId, member));
      await db.delete(users).where(eq(users.id, member));
      expect(await db.select().from(notificationPreferences)).toEqual([]);
    });
  });
});
