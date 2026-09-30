import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { TENANT_DB, withTransaction } from '@/core/database';
import type { Database } from '@/core/database';
import { SettingService } from '@/core/settings';
import {
  notifications,
  relationTuples,
  roleHolderTuple,
  rolePermissionTuple,
  roles,
  users,
} from '@/db/schema';
import type { NotificationRow } from '@/db/schema';
import { ApprovalType } from '@/modules/approval/approval.constants';
import { ApprovalService } from '@/modules/approval/approval.service';
import { NotificationCleanupJob } from '@/modules/notification/notification-cleanup.job';
import { notification } from '@/modules/notification/notification.definition';
import { NotificationService } from '@/modules/notification/notification.service';
import { PermissionService } from '@/modules/permission/permission.service';
import { userRegistrationRequest } from '@/modules/user/user-registration.approval';
import { USER_ROLES_CHANGED_NOTIFICATION } from '@/modules/user/user.notifications';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { inTestTenant, testTenantContext } from './tenant';
import { currentRoleIds } from './versions';

const JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
const SUPER_ADMIN_EMAIL = 'notify-root@example.com';
const DAY_MS = 24 * 60 * 60 * 1000;

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;
let jwt: JwtService;
let tenantId: string;
let rootId: string;
let rootName: string;

// ── 工具 ─────────────────────────────────────────────────────

async function roleIdOf(slug: string): Promise<string> {
  const [role] = await db.select().from(roles).where(eq(roles.slug, slug));
  return role!.id;
}

async function createUser(
  email: string,
  roleIds: string[] = [],
  values: Partial<typeof users.$inferInsert> = {},
): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ email, displayName: `顯示 ${email}`, status: 'active', ...values })
    .returning();
  if (roleIds.length) {
    await db
      .insert(relationTuples)
      .values(roleIds.map((roleId) => roleHolderTuple(roleId, user!.id)));
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

/** 直接寫一筆通知（前置條件不經被測的 API）。 */
async function seedNotification(
  recipientId: string,
  values: Partial<typeof notifications.$inferInsert> = {},
): Promise<NotificationRow> {
  const [row] = await db
    .insert(notifications)
    .values({ recipientId, type: 'sample.happened', params: { n: 1 }, ...values })
    .returning();
  return row!;
}

function notificationsOf(recipientId: string, type?: string): Promise<NotificationRow[]> {
  return db
    .select()
    .from(notifications)
    .where(
      type
        ? and(eq(notifications.recipientId, recipientId), eq(notifications.type, type))
        : eq(notifications.recipientId, recipientId),
    );
}

function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return inTestTenant(app, fn);
}

interface NotificationBody {
  id: string;
  type: string;
  params: Record<string, unknown>;
  link: { route: string; params: Record<string, string> } | null;
  actor: { id: string; name: string } | null;
  readAt: string | null;
  createdAt: string;
}

interface PageBody {
  data: { items: NotificationBody[]; nextCursor: string | null };
}

// ── 生命週期 ─────────────────────────────────────────────────

describe('站內通知（docs/architecture/backend/15-notification.md、ADR-0026）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN_EMAIL;
    process.env.SUPER_ADMIN_PASSWORD = 'NotifyRoot!2026';

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
    rootName = root!.displayName;
  });

  afterAll(async () => {
    await app?.close();
    await closeDb?.();
  });

  // ── 收件人：持有某個權限的人 ─────────────────────────────

  describe('PermissionService.findActiveUserIdsWithPermission（ADR-0026 D5）', () => {
    it('含 super-admin 與持有的角色；排除沒有權限、停用、未啟用、刪除的人、已刪除的角色與過期的邊', async () => {
      const adminId = await roleIdOf('admin');
      const reviewer = await createUser('holders-reviewer@example.com', [adminId]);
      await createUser('holders-auditor@example.com', [await roleIdOf('auditor')]);
      await createUser('holders-inactive@example.com', [adminId], { status: 'inactive' });
      await createUser('holders-pending@example.com', [adminId], { status: 'pending' });
      await createUser('holders-deleted@example.com', [adminId], { deletedAt: new Date() });

      const [gone] = await db
        .insert(roles)
        .values({ slug: 'holders-gone', name: '已刪除的審核角色', deletedAt: new Date() })
        .returning();
      await db.insert(relationTuples).values(rolePermissionTuple(gone!.id, 'approval:review'));
      await createUser('holders-gone-role@example.com', [gone!.id]);

      const expired = await createUser('holders-expired@example.com');
      await db
        .insert(relationTuples)
        .values({ ...roleHolderTuple(adminId, expired), expiresAt: new Date(Date.now() - 1000) });

      const holders = await inTenant(() =>
        app.get(PermissionService).findActiveUserIdsWithPermission('approval:review'),
      );
      expect(holders.toSorted()).toEqual([rootId, reviewer].toSorted());
    });

    it('經由權限依賴樹帶來的鍵也算（持有 user:update 的人持有 user:read）', async () => {
      const [role] = await db
        .insert(roles)
        .values({ slug: 'holders-updater', name: '只有 user:update' })
        .returning();
      await db.insert(relationTuples).values(rolePermissionTuple(role!.id, 'user:update'));
      const updater = await createUser('holders-updater@example.com', [role!.id]);

      const holders = await inTenant(() =>
        app.get(PermissionService).findActiveUserIdsWithPermission('user:read'),
      );
      expect(holders).toContain(updater);
      expect(holders).toContain(rootId);
    });
  });

  // ── notify ────────────────────────────────────────────────

  describe('NotificationService.notify（ADR-0026 D2）', () => {
    it('與業務寫入在同一個交易：提交後才看得到；rollback 時一起消失', async () => {
      const recipient = await createUser('notify-tx@example.com');
      const service = app.get(NotificationService);
      const tenantDb = app.get<Database>(TENANT_DB);
      const input = notification(USER_ROLES_CHANGED_NOTIFICATION, {
        recipientId: recipient,
        actorId: rootId,
        params: { added: ['A'], removed: [] },
      });

      await expect(
        inTenant(() =>
          withTransaction(tenantDb, async (tx) => {
            await service.notify(input, tx);
            throw new Error('業務失敗');
          }),
        ),
      ).rejects.toThrow('業務失敗');
      expect(await notificationsOf(recipient)).toEqual([]);

      await inTenant(() => withTransaction(tenantDb, (tx) => service.notify(input, tx)));
      expect(await notificationsOf(recipient)).toEqual([
        expect.objectContaining({
          type: 'user.rolesChanged',
          actorId: rootId,
          params: { added: ['A'], removed: [] },
          link: null,
          readAt: null,
        }),
      ]);
    });

    it('操作者就是收件人 → 不寫入（D7）', async () => {
      const self = await createUser('notify-self@example.com');
      await inTenant(() =>
        withTransaction(app.get<Database>(TENANT_DB), (tx) =>
          app.get(NotificationService).notify(
            notification(USER_ROLES_CHANGED_NOTIFICATION, {
              recipientId: self,
              actorId: self,
              params: { added: [], removed: ['B'] },
            }),
            tx,
          ),
        ),
      );
      expect(await notificationsOf(self)).toEqual([]);
    });
  });

  // ── 端點 ─────────────────────────────────────────────────

  describe('端點（ADR-0026 D9）', () => {
    let me: string;
    let other: string;
    let mine: NotificationRow[];
    let theirs: NotificationRow;

    beforeEach(async () => {
      await db.delete(notifications);
      me ??= await createUser('endpoint-me@example.com');
      other ??= await createUser('endpoint-other@example.com');
      // 同一個時間的兩筆：keyset 以 id 收尾，不能重複或漏掉
      const sameTime = new Date('2026-09-01T00:00:00.123Z');
      mine = await Promise.all(
        [0, 1, 2, 3, 4].map((i) =>
          seedNotification(me, {
            params: { n: i },
            actorId: rootId,
            createdAt: i < 2 ? sameTime : new Date(Date.UTC(2026, 8, 2 + i)),
            readAt: i === 0 ? new Date() : null,
          }),
        ),
      );
      theirs = await seedNotification(other);
    });

    it('未登入 → 401', async () => {
      await request(http).get('/notifications').expect(401);
      await request(http).get('/notifications/unread-count').expect(401);
    });

    it('只列自己的，新的在前，帶觸發者的名稱', async () => {
      const response = await request(http)
        .get('/notifications')
        .set(await auth(me))
        .expect(200);
      const { items, nextCursor } = (response.body as PageBody).data;
      expect(items.map((item) => item.id)).not.toContain(theirs.id);
      expect(items).toHaveLength(5);
      expect(items[0]).toMatchObject({
        params: { n: 4 },
        actor: { id: rootId, name: rootName },
      });
      expect(nextCursor).toBeNull();
    });

    it('keyset 分頁：逐頁取完不重複不漏，中途有新通知也不影響後面的頁', async () => {
      const headers = await auth(me);
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const query: string = cursor ? `?limit=2&cursor=${cursor}` : '?limit=2';
        // oxlint-disable-next-line no-await-in-loop -- 逐頁依序：下一頁要用上一頁的游標
        const response = await request(http).get(`/notifications${query}`).set(headers).expect(200);
        const page: PageBody['data'] = (response.body as PageBody).data;
        seen.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor;
        pages += 1;
        // 第一頁之後插入一筆新的：它排在最前面，不會擠進後面的頁
        // oxlint-disable-next-line no-await-in-loop -- 要在取第二頁之前插入
        if (pages === 1) await seedNotification(me);
      } while (cursor);
      expect(seen.toSorted()).toEqual(mine.map((row) => row.id).toSorted());
      expect(new Set(seen).size).toBe(seen.length);
    });

    it('unread=true 只列未讀；未讀數只算自己的', async () => {
      const headers = await auth(me);
      const response = await request(http)
        .get('/notifications?unread=true')
        .set(headers)
        .expect(200);
      const { items } = (response.body as PageBody).data;
      expect(items.map((item) => item.id).toSorted()).toEqual(
        mine
          .slice(1)
          .map((row) => row.id)
          .toSorted(),
      );
      const count = await request(http).get('/notifications/unread-count').set(headers).expect(200);
      expect(count.body).toEqual({ data: { count: 4 } });
    });

    it('游標格式不對 → 400 VALIDATION_FAILED', async () => {
      const response = await request(http)
        .get('/notifications?cursor=garbage')
        .set(await auth(me))
        .expect(400);
      expect(response.body).toMatchObject({
        error: { code: 'VALIDATION_FAILED', details: { field: 'cursor' } },
      });
    });

    it('標為已讀：回傳已讀時間；再標一次保留原本的時間', async () => {
      const headers = await auth(me);
      const first = await request(http)
        .post(`/notifications/${mine[3]!.id}/read`)
        .set(headers)
        .expect(200);
      const readAt = (first.body as { data: NotificationBody }).data.readAt;
      expect(readAt).not.toBeNull();
      const again = await request(http)
        .post(`/notifications/${mine[3]!.id}/read`)
        .set(headers)
        .expect(200);
      expect((again.body as { data: NotificationBody }).data.readAt).toBe(readAt);
    });

    it('別人的或不存在的 → 404 NOTIFICATION_NOT_FOUND，別人的通知不被改動', async () => {
      const headers = await auth(me);
      const response = await request(http)
        .post(`/notifications/${theirs.id}/read`)
        .set(headers)
        .expect(404);
      expect(response.body).toMatchObject({ error: { code: 'NOTIFICATION_NOT_FOUND' } });
      await request(http).post(`/notifications/${randomUUID()}/read`).set(headers).expect(404);
      const [row] = await db.select().from(notifications).where(eq(notifications.id, theirs.id));
      expect(row!.readAt).toBeNull();
    });

    it('全部已讀：只動自己的未讀，回傳筆數；之後未讀數為 0', async () => {
      const headers = await auth(me);
      const response = await request(http).post('/notifications/read-all').set(headers).expect(200);
      expect(response.body).toEqual({ data: { updated: 4 } });
      const count = await request(http).get('/notifications/unread-count').set(headers).expect(200);
      expect(count.body).toEqual({ data: { count: 0 } });
      expect((await notificationsOf(other))[0]!.readAt).toBeNull();
    });

    it('已讀不寫稽核', async () => {
      const before = await db.execute<{ total: number }>(
        sql`SELECT count(*)::int AS total FROM audit_logs`,
      );
      await request(http)
        .post('/notifications/read-all')
        .set(await auth(me))
        .expect(200);
      const after = await db.execute<{ total: number }>(
        sql`SELECT count(*)::int AS total FROM audit_logs`,
      );
      expect(after[0]!.total).toBe(before[0]!.total);
    });
  });

  // ── 寫入點 ───────────────────────────────────────────────

  describe('寫入點（ADR-0026 D11）', () => {
    it('匿名註冊 → 每位審核者收到 approval.pending；核准後沒有結果通知（沒有收件人）', async () => {
      const reviewer = await createUser('wp-reviewer@example.com', [await roleIdOf('admin')]);
      const auditor = await createUser('wp-auditor@example.com', [await roleIdOf('auditor')]);

      await request(http)
        .post('/auth/register')
        .send({
          email: 'wp-newcomer@example.com',
          displayName: '申請人甲',
          password: 'ApplicantPassword!2026',
          reason: '加入團隊',
        })
        .expect(202);

      const [pending] = await notificationsOf(reviewer, 'approval.pending');
      expect(pending).toMatchObject({
        actorId: null,
        params: {
          approvalType: 'user.register',
          requesterName: 'wp-newcomer@example.com',
          subject: '申請人甲',
        },
        link: { route: 'approval.detail', params: { approvalId: expect.any(String) } },
      });
      expect(await notificationsOf(rootId, 'approval.pending')).toHaveLength(1);
      expect(await notificationsOf(auditor, 'approval.pending')).toEqual([]);

      const approvalId = pending!.link!.params.approvalId;
      await request(http)
        .post(`/approvals/${approvalId}/approve`)
        .set(await auth(reviewer))
        .send({ roleIds: [] })
        .expect(200);
      const results = await db
        .select()
        .from(notifications)
        .where(eq(notifications.type, 'approval.result'));
      expect(results).toEqual([]);
    });

    it('有審核權限的人自己送出 → 不通知自己；駁回後申請人收到 approval.result', async () => {
      const requester = await createUser('wp-self-reviewer@example.com', [await roleIdOf('admin')]);
      const other = await createUser('wp-other-reviewer@example.com', [await roleIdOf('admin')]);
      const created = await inTenant(() =>
        app.get(ApprovalService).submit({
          ...userRegistrationRequest(
            { email: 'wp-invited@example.com', displayName: '被推薦的人' },
            'hash',
          ),
          requester: { id: requester, name: 'wp-self-reviewer@example.com' },
        }),
      );
      expect(created?.type).toBe(ApprovalType.USER_REGISTER);
      expect(await notificationsOf(requester, 'approval.pending')).toEqual([]);
      expect(await notificationsOf(other, 'approval.pending')).toEqual([
        expect.objectContaining({
          actorId: requester,
          params: expect.objectContaining({ requesterName: 'wp-self-reviewer@example.com' }),
        }),
      ]);

      await request(http)
        .post(`/approvals/${created!.id}/reject`)
        .set(await auth(other))
        .send({ comment: '不需要' })
        .expect(200);
      expect(await notificationsOf(requester, 'approval.result')).toEqual([
        expect.objectContaining({
          actorId: other,
          params: {
            approvalType: 'user.register',
            subject: '被推薦的人',
            status: 'rejected',
          },
          link: { route: 'approval.detail', params: { approvalId: created!.id } },
        }),
      ]);
    });

    it('指派角色 → 被改的人收到 user.rolesChanged（增減的角色名稱）；送同一組角色不通知', async () => {
      const auditorRole = await roleIdOf('auditor');
      const memberRole = await roleIdOf('member');
      const target = await createUser('wp-roles@example.com', [memberRole]);
      const [auditor] = await db.select().from(roles).where(eq(roles.id, auditorRole));
      const [member] = await db.select().from(roles).where(eq(roles.id, memberRole));
      const headers = await auth(rootId);

      await request(http)
        .put(`/users/${target}/roles`)
        .set(headers)
        .send({ roleIds: [auditorRole], expectedRoleIds: await currentRoleIds(db, target) })
        .expect(200);
      expect(await notificationsOf(target, 'user.rolesChanged')).toEqual([
        expect.objectContaining({
          actorId: rootId,
          params: { added: [auditor!.name], removed: [member!.name] },
          link: { route: 'account.profile', params: {} },
        }),
      ]);

      await request(http)
        .put(`/users/${target}/roles`)
        .set(headers)
        .send({ roleIds: [auditorRole], expectedRoleIds: [auditorRole] })
        .expect(200);
      expect(await notificationsOf(target, 'user.rolesChanged')).toHaveLength(1);
    });
  });

  // ── 保留清理 ─────────────────────────────────────────────

  describe('notification.cleanup（ADR-0026 D10）', () => {
    it('依系統設定刪除「已讀超過 N 天」與「每人超過上限的最舊通知」，未讀在上限內保留', async () => {
      await db.delete(notifications);
      const heavy = await createUser('cleanup-heavy@example.com');
      const light = await createUser('cleanup-light@example.com');
      const now = Date.now();

      // light：一筆 10 天前讀過（留）、一筆 40 天前讀過（刪）、一筆很舊但未讀（留）
      const keptRead = await seedNotification(light, {
        readAt: new Date(now - 10 * DAY_MS),
        createdAt: new Date(now - 11 * DAY_MS),
      });
      await seedNotification(light, {
        readAt: new Date(now - 40 * DAY_MS),
        createdAt: new Date(now - 41 * DAY_MS),
      });
      const oldUnread = await seedNotification(light, { createdAt: new Date(now - 300 * DAY_MS) });
      // heavy：12 筆未讀，上限 10 → 刪掉最舊的 2 筆
      const heavyRows = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          seedNotification(heavy, { createdAt: new Date(now - (i + 1) * 60_000) }),
        ),
      );

      const settings = app.get(SettingService);
      await inTenant(async () => {
        await settings.save('notification.retentionDays', 20, rootId);
        await settings.save('notification.maxPerUser', 10, rootId);
        settings.invalidate();
      });

      const report = await inTenant(() => app.get(NotificationCleanupJob).run());
      expect(report).toMatchObject({
        retentionDays: 20,
        maxPerUser: 10,
        deletedRead: 1,
        deletedBeyondLimit: 2,
      });
      expect((await notificationsOf(light)).map((row) => row.id).toSorted()).toEqual(
        [keptRead.id, oldUnread.id].toSorted(),
      );
      expect((await notificationsOf(heavy)).map((row) => row.id).toSorted()).toEqual(
        heavyRows
          .slice(0, 10)
          .map((row) => row.id)
          .toSorted(),
      );
    });

    it('收件人被永久刪除 → 通知一起刪掉；觸發者被永久刪除 → 通知保留、觸發者變成 null', async () => {
      const recipient = await createUser('fk-recipient@example.com');
      const actor = await createUser('fk-actor@example.com');
      const kept = await seedNotification(rootId, { actorId: actor });
      await seedNotification(recipient);

      await db.delete(users).where(eq(users.id, actor));
      await db.delete(users).where(eq(users.id, recipient));

      expect(await notificationsOf(recipient)).toEqual([]);
      const [row] = await db.select().from(notifications).where(eq(notifications.id, kept.id));
      expect(row!.actorId).toBeNull();
    });
  });
});
