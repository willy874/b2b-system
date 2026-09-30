import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import request from 'supertest';
import type { Response } from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DomainEventBus } from '@/core/events';
import {
  auditLogs,
  fileFolders,
  refreshTokens,
  relationTuples,
  roleHolderTuple,
  roles,
  users,
} from '@/db/schema';
import { hashPassword } from '@/modules/credential/password';
import { TrashService } from '@/modules/trash/trash.service';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { inTestTenant } from './tenant';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;
let rootToken: string;
let rootId: string;

const ROOT = { email: 'trash-root@example.com', password: 'RootPassword!2026' };
const PASSWORD = 'TrashPassword!2026';
const DAY_MS = 24 * 60 * 60 * 1000;

interface TrashItemBody {
  id: string;
  type: string;
  name: string;
  description: string | null;
  deletedAt: string;
  deletedBy: { id: string; name: string } | null;
  purgeAt: string;
}

function dataOf<T>(response: Response): T {
  return (response.body as { data: T }).data;
}

async function roleId(slug: string): Promise<string> {
  const [row] = await db.select({ id: roles.id }).from(roles).where(eq(roles.slug, slug));
  return row!.id;
}

/** 直接寫 DB 建立一位 active 的使用者（可選：密碼、持有的角色、username）。 */
async function createUser(
  email: string,
  options: { roles?: string[]; password?: boolean; username?: string } = {},
): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({
      email,
      username: options.username ?? null,
      displayName: `名稱 ${email}`,
      passwordHash: options.password ? await hashPassword(PASSWORD) : null,
      status: 'active',
    })
    .returning();
  for (const slug of options.roles ?? []) {
    // oxlint-disable-next-line no-await-in-loop -- 測試資料，筆數少
    await db.insert(relationTuples).values(roleHolderTuple(await roleId(slug), user!.id));
  }
  return user!.id;
}

async function login(email: string, password = PASSWORD): Promise<string> {
  const response = await request(http).post('/auth/login').send({ email, password }).expect(200);
  return dataOf<{ accessToken: string }>(response).accessToken;
}

function deleteUser(id: string, token = rootToken) {
  return request(http).delete(`/users/${id}`).set('authorization', `Bearer ${token}`);
}

function restoreUser(id: string, token = rootToken) {
  return request(http).post(`/users/${id}/restore`).set('authorization', `Bearer ${token}`);
}

function listTrash(query: Record<string, unknown>, token = rootToken) {
  return request(http).get('/trash').query(query).set('authorization', `Bearer ${token}`);
}

async function rowOf(id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row;
}

/** 把刪除時間往前推，模擬已經在回收桶裡放了 `days` 天。 */
async function deletedDaysAgo(id: string, days: number): Promise<void> {
  await db
    .update(users)
    .set({ deletedAt: new Date(Date.now() - days * DAY_MS) })
    .where(eq(users.id, id));
}

function purge() {
  return inTestTenant(app, () => app.get(TrashService).purgeExpired());
}

async function auditActions(resourceId: string): Promise<string[]> {
  const rows = await db
    .select({ action: auditLogs.action })
    .from(auditLogs)
    .where(eq(auditLogs.resourceId, resourceId));
  return rows.map((row) => row.action);
}

describe('回收桶與使用者還原（docs/architecture/backend/13-trash.md、ADR-0025 D6、D9～D11）', () => {
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

    const { AppModule } = await import('@/app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    http = await listenOnLoopback(app);

    rootToken = await login(ROOT.email, ROOT.password);
    const [root] = await db.select().from(users).where(eq(users.email, ROOT.email));
    rootId = root!.id;
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    delete process.env.AUTH_RATE_LIMIT;
  });

  describe('POST /users/:id/restore', () => {
    it('清掉 deleted_at、狀態與仍存在的角色回來、寫稽核、補建個人資料夾', async () => {
      const id = await createUser('restore-a@example.com', { roles: ['member'] });
      await deleteUser(id).expect(204);
      await app.get(DomainEventBus).drain();

      const response = await restoreUser(id).expect(200);
      expect(dataOf<{ status: string; roles: Array<{ slug: string }> }>(response)).toMatchObject({
        status: 'active',
        roles: [{ slug: 'member' }],
      });
      expect((await rowOf(id))?.deletedAt).toBeNull();
      expect(await auditActions(id)).toContain('user.restore');

      // member 有 file:access：permissions.changed 的訂閱者補建個人資料夾
      await app.get(DomainEventBus).drain();
      const folders = await db
        .select()
        .from(fileFolders)
        .where(and(eq(fileFolders.ownerId, id), isNull(fileFolders.deletedAt)));
      expect(folders).toHaveLength(1);
    });

    it('刪除前停用的帳號還原後仍是停用；refresh token 不回復（要重新登入）', async () => {
      const id = await createUser('restore-b@example.com', { password: true });
      await login('restore-b@example.com');
      await db.update(users).set({ status: 'inactive' }).where(eq(users.id, id));
      await deleteUser(id).expect(204);

      await restoreUser(id).expect(200);
      expect((await rowOf(id))?.status).toBe('inactive');
      const live = await db
        .select()
        .from(refreshTokens)
        .where(and(eq(refreshTokens.userId, id), isNull(refreshTokens.revokedAt)));
      expect(live).toHaveLength(0);
    });

    it('email 已被新帳號使用 → 409 USER_EMAIL_DUPLICATE，details.conflictingUserId 是新帳號', async () => {
      const old = await createUser('restore-dup@example.com');
      await deleteUser(old).expect(204);
      const replacement = await createUser('restore-dup@example.com');

      const response = await restoreUser(old).expect(409);
      expect(response.body).toMatchObject({
        error: {
          code: 'USER_EMAIL_DUPLICATE',
          details: { field: 'email', conflictingUserId: replacement },
        },
      });
      expect((await rowOf(old))?.deletedAt).not.toBeNull();
    });

    it('username 已被新帳號使用 → 409 USER_USERNAME_DUPLICATE（不分大小寫）', async () => {
      const old = await createUser('restore-name-a@example.com', { username: 'Restorer' });
      await deleteUser(old).expect(204);
      const replacement = await createUser('restore-name-b@example.com', { username: 'restorer' });

      const response = await restoreUser(old).expect(409);
      expect(response.body).toMatchObject({
        error: { code: 'USER_USERNAME_DUPLICATE', details: { conflictingUserId: replacement } },
      });
    });

    it('反提權：admin 不能還原持有 super-admin 的帳號（403 AUTHZ_ESCALATION），仍維持刪除', async () => {
      await createUser('restore-admin@example.com', { roles: ['admin'], password: true });
      const adminToken = await login('restore-admin@example.com');
      const target = await createUser('restore-super@example.com', { roles: ['super-admin'] });
      await deleteUser(target).expect(204);

      const response = await restoreUser(target, adminToken).expect(403);
      expect(response.body).toMatchObject({ error: { code: 'AUTHZ_ESCALATION' } });
      expect((await rowOf(target))?.deletedAt).not.toBeNull();

      // 同一位 admin 還原只持有 member 的人沒問題
      const member = await createUser('restore-member@example.com', { roles: ['member'] });
      await deleteUser(member).expect(204);
      await restoreUser(member, adminToken).expect(200);
    });

    it('沒有被刪除 → 409 USER_NOT_DELETED；不存在 → 404 USER_NOT_FOUND', async () => {
      const id = await createUser('restore-live@example.com');
      const live = await restoreUser(id).expect(409);
      expect(live.body).toMatchObject({ error: { code: 'USER_NOT_DELETED' } });

      const missing = await restoreUser('00000000-0000-4000-8000-000000000000').expect(404);
      expect(missing.body).toMatchObject({ error: { code: 'USER_NOT_FOUND' } });
    });

    it('沒有 user:delete（auditor）→ 403 AUTHZ_FORBIDDEN', async () => {
      await createUser('restore-auditor@example.com', { roles: ['auditor'], password: true });
      const auditorToken = await login('restore-auditor@example.com');
      const id = await createUser('restore-c@example.com');
      await deleteUser(id).expect(204);

      const response = await restoreUser(id, auditorToken).expect(403);
      expect(response.body).toMatchObject({ error: { code: 'AUTHZ_FORBIDDEN' } });
    });
  });

  describe('GET /trash', () => {
    it('只列已刪除的使用者，新刪除的在前，帶刪除者與預計永久刪除的時間', async () => {
      const first = await createUser('trash-list-1@example.com');
      const second = await createUser('trash-list-2@example.com');
      const live = await createUser('trash-list-live@example.com');
      await deleteUser(first).expect(204);
      await deleteUser(second).expect(204);

      const response = await listTrash({ type: 'user', keyword: 'trash-list' }).expect(200);
      const { items, pagination } = dataOf<{
        items: TrashItemBody[];
        pagination: { total: number };
      }>(response);
      expect(items.map((item) => item.id)).toEqual([second, first]);
      expect(items.map((item) => item.id)).not.toContain(live);
      expect(pagination.total).toBe(2);
      expect(items[0]).toMatchObject({
        type: 'user',
        name: '名稱 trash-list-2@example.com',
        description: 'trash-list-2@example.com',
        deletedBy: { id: rootId },
      });
      const { deletedAt, purgeAt } = items[0]!;
      expect(Date.parse(purgeAt) - Date.parse(deletedAt)).toBe(30 * DAY_MS);
    });

    it('沒有 user:delete（auditor）→ 403；admin → 200', async () => {
      await createUser('trash-auditor@example.com', { roles: ['auditor'], password: true });
      await listTrash({ type: 'user' }, await login('trash-auditor@example.com')).expect(403);

      await createUser('trash-admin@example.com', { roles: ['admin'], password: true });
      await listTrash({ type: 'user' }, await login('trash-admin@example.com')).expect(200);
    });

    it('不支援的類型 → 400 VALIDATION_FAILED', async () => {
      const response = await listTrash({ type: 'invoice' }).expect(400);
      expect(response.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    });
  });

  describe('trash.purge（到期永久刪除）', () => {
    beforeEach(async () => {
      // 其他案例留在回收桶裡的人不影響斷言：先把他們都移回保留期限內
      await db.update(users).set({ deletedAt: new Date() }).where(isNotNull(users.deletedAt));
    });

    it('超過保留期限的使用者硬刪除：關係圖的邊、refresh token 一併清掉，寫 user.purge 稽核', async () => {
      const expired = await createUser('purge-expired@example.com', {
        roles: ['member'],
        password: true,
      });
      await login('purge-expired@example.com');
      await deleteUser(expired).expect(204);
      await app.get(DomainEventBus).drain();
      // 個人資料夾（空的）在刪除時已被軟刪除，但仍以 owner_id 參照他：先移除，這一案只看使用者本身
      await db.delete(fileFolders).where(eq(fileFolders.ownerId, expired));
      await deletedDaysAgo(expired, 31);

      const recent = await createUser('purge-recent@example.com');
      await deleteUser(recent).expect(204);
      await deletedDaysAgo(recent, 10);

      const report = await purge();
      expect(report).toMatchObject({ retentionDays: 30, purged: { user: 1 } });

      expect(await rowOf(expired)).toBeUndefined();
      expect(
        await db.select().from(relationTuples).where(eq(relationTuples.subjectId, expired)),
      ).toHaveLength(0);
      expect(
        await db.select().from(refreshTokens).where(eq(refreshTokens.userId, expired)),
      ).toHaveLength(0);
      expect(await rowOf(recent)).toBeDefined();

      const [audit] = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.resourceId, expired), eq(auditLogs.action, 'user.purge')));
      expect(audit).toMatchObject({
        actorId: null,
        actorEmail: 'system',
        resourceType: 'user',
        resourceName: 'purge-expired@example.com',
      });
      expect(audit?.metadata).toMatchObject({ retentionDays: 30 });
    });

    it('還擁有資料夾（file_folders.owner_id 是 RESTRICT）的使用者這一輪略過', async () => {
      const owner = await createUser('purge-owner@example.com');
      await db.insert(fileFolders).values({
        name: '他的東西',
        parentId: null,
        kind: 'personal',
        ownerId: owner,
      });
      await deleteUser(owner).expect(204);
      await deletedDaysAgo(owner, 60);

      const report = await purge();
      expect(report.purged.user ?? 0).toBe(0);
      expect(await rowOf(owner)).toBeDefined();
      expect(await auditActions(owner)).not.toContain('user.purge');
    });

    it('保留天數依系統設定 trash.retentionDays', async () => {
      const id = await createUser('purge-setting@example.com');
      await deleteUser(id).expect(204);
      await deletedDaysAgo(id, 10);

      expect((await purge()).purged.user ?? 0).toBe(0);
      await request(http)
        .patch('/system/settings')
        .set('authorization', `Bearer ${rootToken}`)
        .send({ values: { 'trash.retentionDays': 7 } })
        .expect(200);

      const report = await purge();
      expect(report).toMatchObject({ retentionDays: 7, purged: { user: 1 } });
      expect(await rowOf(id)).toBeUndefined();

      await request(http)
        .patch('/system/settings')
        .set('authorization', `Bearer ${rootToken}`)
        .send({ values: { 'trash.retentionDays': null } })
        .expect(200);
    });

    it('trash.retentionDays 超出 1～365 → 400', async () => {
      await request(http)
        .patch('/system/settings')
        .set('authorization', `Bearer ${rootToken}`)
        .send({ values: { 'trash.retentionDays': 0 } })
        .expect(400);
      await request(http)
        .patch('/system/settings')
        .set('authorization', `Bearer ${rootToken}`)
        .send({ values: { 'trash.retentionDays': 366 } })
        .expect(400);
    });
  });
});
