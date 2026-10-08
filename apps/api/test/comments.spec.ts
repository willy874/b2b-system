import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Response } from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ObjectStorage } from '@/core/storage';
import {
  auditLogs,
  comments,
  fileFolders,
  notifications,
  relationTuples,
  roleHolderTuple,
  rolePermissionTuple,
  roles,
  users,
  watches,
} from '@/db/schema';
import { WatchService } from '@/modules/comment/watch.service';
import { hashPassword } from '@/modules/credential/password';
import { FileImageService } from '@/modules/file/file-image.service';
import { TrashService } from '@/modules/trash/trash.service';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { InMemoryObjectStorage } from './in-memory-object-storage';
import { inTestTenant } from './tenant';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;
const storage = new InMemoryObjectStorage();

const PASSWORD = 'CommentsPassword!2026';
const ROOT = { email: 'comments-root@example.com', password: 'Quiet-Harbor-Lantern-26' };
const ADMIN = 'comments-admin@example.com';
const READER = 'comments-reader@example.com';
const MEMBER = 'comments-member@example.com';
const SUBJECT = 'comments-subject@example.com';
const DAY_MS = 24 * 60 * 60 * 1000;

interface CommentBody {
  id: string;
  body: string;
  author: { id: string } | null;
  mentions: Array<{ id: string; displayName: string }>;
  version: number;
  editedAt: string | null;
  canEdit: boolean;
  canDelete: boolean;
}

interface CommentPage {
  items: CommentBody[];
  nextCursor: string | null;
}

function dataOf<T>(response: Response): T {
  return (response.body as { data: T }).data;
}

function errorOf(response: Response): { code: string; details?: Record<string, unknown> } {
  return (response.body as { error: { code: string; details?: Record<string, unknown> } }).error;
}

const tokens = new Map<string, string>();
async function login(email: string, password = PASSWORD): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const response = await request(http).post('/auth/login').send({ email, password }).expect(200);
  const token = dataOf<{ accessToken: string }>(response).accessToken;
  tokens.set(email, token);
  return token;
}

async function as(email: string, password = PASSWORD) {
  const token = await login(email, password);
  const auth = (req: request.Test) => req.set('authorization', `Bearer ${token}`);
  return {
    get: (path: string) => auth(request(http).get(path)),
    post: (path: string, body: object = {}) => auth(request(http).post(path)).send(body),
    put: (path: string, body: object = {}) => auth(request(http).put(path)).send(body),
    patch: (path: string, body: object) => auth(request(http).patch(path)).send(body),
    delete: (path: string) => auth(request(http).delete(path)),
  };
}

async function createUser(email: string, roleId: string): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({
      email,
      displayName: `名稱 ${email}`,
      passwordHash: await hashPassword(PASSWORD),
      status: 'active',
    })
    .returning();
  await db.insert(relationTuples).values(roleHolderTuple(roleId, user!.id));
  return user!.id;
}

async function roleIdOf(slug: string): Promise<string> {
  const [role] = await db.select().from(roles).where(eq(roles.slug, slug));
  return role!.id;
}

async function notificationsOf(recipientId: string, type: string) {
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.recipientId, recipientId), eq(notifications.type, type)));
}

const ids: Record<string, string> = {};
const onSubject = () => `/comments/user/${ids.subject}`;

describe('留言與關注（docs/architecture/backend/24-comment.md）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = ROOT.email;
    process.env.SUPER_ADMIN_PASSWORD = ROOT.password;
    process.env.AUTH_RATE_LIMIT = '1000';

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);

    // 只有 user:read 的人：看得到使用者，可以留言與關注，不能刪別人的留言
    const [readerRole] = await db
      .insert(roles)
      .values({ slug: 'comments-reader', name: 'comments-reader', isSystem: false })
      .returning();
    await db.insert(relationTuples).values(rolePermissionTuple(readerRole!.id, 'user:read'));
    ids.admin = await createUser(ADMIN, await roleIdOf('admin'));
    ids.reader = await createUser(READER, readerRole!.id);
    ids.member = await createUser(MEMBER, await roleIdOf('member'));
    ids.subject = await createUser(SUBJECT, await roleIdOf('member'));

    const { AppModule } = await import('@/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ObjectStorage)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    http = await listenOnLoopback(app);
  });

  afterAll(async () => {
    await app.get(FileImageService).whenIdle();
    await app.close();
    await closeDb();
    delete process.env.AUTH_RATE_LIMIT;
  });

  describe('留言（§3.1）', () => {
    it('admin 留言並提及 reader：作者自動關注，reader 收到提及的通知', async () => {
      const admin = await as(ADMIN);
      const created = dataOf<CommentBody>(
        await admin
          .post(onSubject(), { body: '  @reader 請確認權限  ', mentionIds: [ids.reader] })
          .expect(201),
      );
      ids.first = created.id;
      expect(created).toMatchObject({
        body: '@reader 請確認權限',
        author: { id: ids.admin },
        mentions: [{ id: ids.reader, displayName: `名稱 ${READER}` }],
        version: 1,
        editedAt: null,
        canEdit: true,
        canDelete: true,
      });
      const watching = await db.select().from(watches).where(eq(watches.userId, ids.admin!));
      expect(watching).toMatchObject([{ resourceType: 'user', resourceId: ids.subject }]);

      const [mentioned] = await notificationsOf(ids.reader!, 'comment.mentioned');
      expect(mentioned).toMatchObject({
        actorId: ids.admin,
        params: {
          resourceType: 'user',
          resourceName: `名稱 ${SUBJECT}`,
          excerpt: '@reader 請確認權限',
        },
        link: { route: 'user.detail', params: { userId: ids.subject } },
      });
    });

    it('看得到資源的人讀得到；看不到（沒有 user:read）403 並寫 authz.denied', async () => {
      const page = dataOf<CommentPage>(await (await as(READER)).get(onSubject()).expect(200));
      expect(page.items.map((item) => [item.id, item.canEdit, item.canDelete])).toEqual([
        [ids.first, false, false],
      ]);

      const denied = await (await as(MEMBER)).get(onSubject()).expect(403);
      expect(errorOf(denied).code).toBe('AUTHZ_FORBIDDEN');
      const [audit] = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'authz.denied'), eq(auditLogs.actorId, ids.member!)));
      expect(audit?.metadata).toMatchObject({
        route: 'GET /comments/:resourceType/:resourceId',
        missing: ['user:read'],
      });
    });

    it('不認得的資源類型 404、不存在的使用者 404', async () => {
      const admin = await as(ADMIN);
      const unknown = await admin.get(`/comments/webhook/${ids.subject}`).expect(404);
      expect(errorOf(unknown).code).toBe('COMMENT_RESOURCE_TYPE_UNKNOWN');
      const missing = await admin
        .get('/comments/user/00000000-0000-4000-8000-000000000000')
        .expect(404);
      expect(errorOf(missing).code).toBe('USER_NOT_FOUND');
    });

    it('提及看不到資源的人 422，不寫入', async () => {
      const response = await (
        await as(ADMIN)
      )
        .post(onSubject(), { body: '看一下', mentionIds: [ids.member] })
        .expect(422);
      expect(errorOf(response)).toMatchObject({
        code: 'COMMENT_MENTION_INVALID',
        details: { userIds: [ids.member] },
      });
      expect(await db.select().from(comments)).toHaveLength(1);
    });

    it('@提及的候選只有看得到資源的人', async () => {
      const { items } = dataOf<{ items: Array<{ id: string }> }>(
        await (await as(ADMIN)).get(`${onSubject()}/mentionable?q=comments-`).expect(200),
      );
      const found = items.map((item) => item.id);
      expect(found).toEqual(expect.arrayContaining([ids.admin, ids.reader]));
      expect(found).not.toContain(ids.member);
      expect(found).not.toContain(ids.subject);
    });

    it('關注者收到新留言的通知（作者自己不收）', async () => {
      const reader = await as(READER);
      expect(dataOf(await reader.put(`/watches/user/${ids.subject}`).expect(200))).toEqual({
        watching: true,
        watcherCount: 2,
      });
      ids.second = dataOf<CommentBody>(
        await (await as(ADMIN)).post(onSubject(), { body: '第二則' }).expect(201),
      ).id;
      expect(await notificationsOf(ids.reader!, 'comment.created')).toHaveLength(1);
      expect(await notificationsOf(ids.admin!, 'comment.created')).toHaveLength(0);
    });

    it('新的在前，keyset 分頁', async () => {
      const reader = await as(READER);
      const first = dataOf<CommentPage>(await reader.get(`${onSubject()}?limit=1`).expect(200));
      expect(first.items.map((item) => item.id)).toEqual([ids.second]);
      expect(first.nextCursor).not.toBeNull();
      const second = dataOf<CommentPage>(
        await reader
          .get(`${onSubject()}?limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`)
          .expect(200),
      );
      expect(second.items.map((item) => item.id)).toEqual([ids.first]);
    });

    it('只有作者能編輯；版本不符 409', async () => {
      const denied = await (
        await as(READER)
      )
        .patch(`/comments/${ids.first}`, { body: '改', version: 1 })
        .expect(403);
      expect(errorOf(denied)).toMatchObject({
        code: 'AUTHZ_FORBIDDEN',
        details: { reason: 'notAuthor' },
      });

      const admin = await as(ADMIN);
      const edited = dataOf<CommentBody>(
        await admin
          .patch(`/comments/${ids.first}`, {
            body: '@reader 已確認',
            mentionIds: [ids.reader],
            version: 1,
          })
          .expect(200),
      );
      expect(edited).toMatchObject({ body: '@reader 已確認', version: 2 });
      expect(edited.editedAt).not.toBeNull();
      // 原本就提及的人不再收一次
      expect(await notificationsOf(ids.reader!, 'comment.mentioned')).toHaveLength(1);

      const stale = await admin
        .patch(`/comments/${ids.first}`, { body: '再改', version: 1 })
        .expect(409);
      expect(errorOf(stale)).toMatchObject({
        code: 'COMMENT_VERSION_CONFLICT',
        details: { current: 2 },
      });
    });

    it('刪除：別人的要 comment:delete；管理者刪別人的寫稽核，作者刪自己的不寫', async () => {
      const reader = await as(READER);
      const own = dataOf<CommentBody>(
        await reader.post(onSubject(), { body: 'reader 的留言' }).expect(201),
      );
      const denied = await reader.delete(`/comments/${ids.second}`).expect(403);
      expect(errorOf(denied).details).toMatchObject({ missing: ['comment:delete'] });

      await (await as(ADMIN)).delete(`/comments/${own.id}`).expect(204);
      const [audit] = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'comment.delete'), eq(auditLogs.resourceId, own.id)));
      expect(audit).toMatchObject({
        actorId: ids.admin,
        resourceType: 'comment',
        metadata: { targetType: 'user', targetId: ids.subject, authorId: ids.reader },
      });

      await (await as(ADMIN)).delete(`/comments/${ids.second}`).expect(204);
      const selfDeleted = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'comment.delete'), eq(auditLogs.resourceId, ids.second!)));
      expect(selfDeleted).toHaveLength(0);
      await (await as(ADMIN)).delete(`/comments/${ids.second}`).expect(404);
    });
  });

  describe('關注（§3.2、§4）', () => {
    it('看不到資源不能關注；取消關注不必看得到', async () => {
      const member = await as(MEMBER);
      await member.put(`/watches/user/${ids.subject}`).expect(403);
      expect(dataOf(await member.delete(`/watches/user/${ids.subject}`).expect(200))).toEqual({
        watching: false,
        watcherCount: 2,
      });
    });

    it('使用者被修改時入列 watch.notify；工作通知關注者（不含修改的人）', async () => {
      const admin = await as(ADMIN);
      const [subject] = await db.select().from(users).where(eq(users.id, ids.subject!));
      await admin
        .patch(`/users/${ids.subject}`, { displayName: '改過的名稱', version: subject!.version })
        .expect(200);
      const queued = dataOf<{ items: Array<{ id: string }> }>(
        await (await as(ROOT.email, ROOT.password)).get('/jobs?name=watch.notify').expect(200),
      ).items;
      expect(queued).toHaveLength(1);

      // 測試程序不跑 worker：直接執行 handler
      const result = await inTestTenant(app, () =>
        app.get(WatchService).notifyWatchers({
          resourceType: 'user',
          resourceId: ids.subject!,
          actorId: ids.admin!,
        }),
      );
      expect(result).toEqual({ notified: 1 });
      const [updated] = await notificationsOf(ids.reader!, 'watch.resourceUpdated');
      expect(updated).toMatchObject({
        actorId: ids.admin,
        params: { resourceType: 'user', resourceName: '改過的名稱' },
      });
      expect(await notificationsOf(ids.admin!, 'watch.resourceUpdated')).toHaveLength(0);
    });
  });

  describe('永久刪除（D10）', () => {
    it('軟刪除保留留言與關注；回收桶到期永久刪除時一起清掉', async () => {
      await (await as(ADMIN)).delete(`/users/${ids.subject}`).expect(204);
      expect(
        await db.select().from(comments).where(eq(comments.resourceId, ids.subject!)),
      ).toHaveLength(1);

      await db
        .update(users)
        .set({ deletedAt: new Date(Date.now() - 400 * DAY_MS) })
        .where(eq(users.id, ids.subject!));
      // 還擁有個人資料夾的人這一輪不會被永久刪除（docs/architecture/backend/14-revisions.md §9.2 D11）：當作資料夾已先清掉
      await db.delete(fileFolders).where(eq(fileFolders.ownerId, ids.subject!));
      await inTestTenant(app, () => app.get(TrashService).purgeExpired());
      expect(
        await db.select().from(comments).where(eq(comments.resourceId, ids.subject!)),
      ).toHaveLength(0);
      expect(
        await db.select().from(watches).where(eq(watches.resourceId, ids.subject!)),
      ).toHaveLength(0);
    });
  });
});
