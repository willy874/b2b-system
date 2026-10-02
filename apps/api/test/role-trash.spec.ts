import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { and, eq, isNotNull, or } from 'drizzle-orm';
import request from 'supertest';
import type { Response } from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  auditLogs,
  authzRevision,
  isRoleHolderTuple,
  relationTuples,
  ROLE_HOLDER_RELATION,
  ROLE_OBJECT_TYPE,
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
import { currentRoleIds } from './versions';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;
let rootToken: string;
let rootId: string;

const ROOT = { email: 'role-trash-root@example.com', password: 'RootPassword!2026' };
const PASSWORD = 'RoleTrashPassword!2026';
const DAY_MS = 24 * 60 * 60 * 1000;

function dataOf<T>(response: Response): T {
  return (response.body as { data: T }).data;
}

function auth(token = rootToken) {
  return { authorization: `Bearer ${token}` };
}

/** 經 API 建立角色（權限鍵走一般的寫入路徑）。 */
async function createRole(name: string, permissionKeys: string[]): Promise<string> {
  const response = await request(http)
    .post('/roles')
    .set(auth())
    .send({ name, permissionKeys })
    .expect(201);
  return dataOf<{ id: string }>(response).id;
}

async function roleIdOf(slug: string): Promise<string> {
  const [row] = await db.select({ id: roles.id }).from(roles).where(eq(roles.slug, slug));
  return row!.id;
}

/** 直接寫 DB 建立一位 active、有密碼的使用者，並持有指定的角色（id）。 */
async function createUser(email: string, roleIds: string[] = []): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({
      email,
      displayName: `名稱 ${email}`,
      passwordHash: await hashPassword(PASSWORD),
      status: 'active',
    })
    .returning();
  if (roleIds.length) {
    await db.insert(relationTuples).values(roleIds.map((id) => roleHolderTuple(id, user!.id)));
  }
  return user!.id;
}

async function login(email: string, password = PASSWORD): Promise<string> {
  const response = await request(http).post('/auth/login').send({ email, password }).expect(200);
  return dataOf<{ accessToken: string }>(response).accessToken;
}

function deleteRole(id: string, token = rootToken) {
  return request(http).delete(`/roles/${id}?force=true`).set(auth(token));
}

function restoreRole(id: string, token = rootToken) {
  return request(http).post(`/roles/${id}/restore`).set(auth(token));
}

/** 持有這個角色的邊（不論角色是否刪除）。 */
async function holderEdges(roleId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: relationTuples.subjectId })
    .from(relationTuples)
    .where(and(isRoleHolderTuple(), eq(relationTuples.objectId, roleId)));
  return rows.map((row) => row.userId).toSorted();
}

async function revision(): Promise<number> {
  const [row] = await db.select({ revision: authzRevision.revision }).from(authzRevision);
  return Number(row?.revision ?? 0);
}

async function auditOf(resourceId: string, action: string) {
  const [row] = await db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.resourceId, resourceId), eq(auditLogs.action, action)));
  return row;
}

function purge() {
  return inTestTenant(app, () => app.get(TrashService).purgeExpired());
}

describe('角色的還原與回收桶（docs/architecture/backend/13-trash.md §6、docs/architecture/backend/14-revisions.md §9.2 D2、R3）', () => {
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

  describe('刪除保留持有者邊（D2）', () => {
    it('邊留著，但持有者立刻失去權限；使用者端的讀取與依角色篩選都看不到刪除的角色', async () => {
      const roleId = await createRole('稽核檢視 A', ['auditLog:read']);
      const holder = await createUser('keep-a@example.com', [roleId]);
      const token = await login('keep-a@example.com');
      await request(http).get('/audit-logs').set(auth(token)).expect(200);

      await deleteRole(roleId).expect(204);

      expect(await holderEdges(roleId)).toEqual([holder]);
      await request(http).get('/audit-logs').set(auth(token)).expect(403);
      const detail = await request(http).get(`/users/${holder}`).set(auth()).expect(200);
      expect(dataOf<{ roles: unknown[] }>(detail).roles).toEqual([]);
      const filtered = await request(http)
        .get('/users')
        .query(`roleId=${roleId}`)
        .set(auth())
        .expect(200);
      expect(dataOf<{ pagination: { total: number } }>(filtered).pagination.total).toBe(0);
    });

    it('刪除與還原都讓關係圖的 revision +1（不寫 relation_tuples，由 roles 的 trigger 補上）', async () => {
      const roleId = await createRole('版本號 A', ['auditLog:read']);
      const start = await revision();
      await deleteRole(roleId).expect(204);
      expect(await revision()).toBe(start + 1);
      await restoreRole(roleId).expect(200);
      expect(await revision()).toBe(start + 2);
    });

    it('PUT /users/:id/roles 只換未刪除的角色：刪除角色的休眠邊留著，還原後一起回來', async () => {
      const deleted = await createRole('休眠 A', ['auditLog:read']);
      const replaced = await createRole('被換掉 A', ['user:read']);
      const added = await createRole('新指派 A', ['role:read']);
      const holder = await createUser('dormant-a@example.com', [deleted, replaced]);
      await deleteRole(deleted).expect(204);

      await request(http)
        .put(`/users/${holder}/roles`)
        .set(auth())
        .send({ roleIds: [added], expectedRoleIds: await currentRoleIds(db, holder) })
        .expect(200);
      expect(await holderEdges(deleted)).toEqual([holder]);
      expect(await holderEdges(replaced)).toEqual([]);

      await restoreRole(deleted).expect(200);
      const detail = await request(http).get(`/users/${holder}`).set(auth()).expect(200);
      expect(
        dataOf<{ roles: Array<{ id: string }> }>(detail)
          .roles.map((role) => role.id)
          .toSorted(),
      ).toEqual([added, deleted].toSorted());
    });
  });

  describe('POST /roles/:id/restore', () => {
    it('原本的持有者拿回權限；回應帶 holdersRestored 與持有者數，寫 role.restore 稽核', async () => {
      const roleId = await createRole('稽核檢視 B', ['auditLog:read']);
      const holder = await createUser('restore-b@example.com', [roleId]);
      const gone = await createUser('restore-b-gone@example.com', [roleId]);
      const token = await login('restore-b@example.com');
      await deleteRole(roleId).expect(204);
      await request(http).delete(`/users/${gone}`).set(auth()).expect(204);
      await request(http).get('/audit-logs').set(auth(token)).expect(403);

      const response = await restoreRole(roleId).expect(200);
      expect(dataOf<{ userCount: number; holdersRestored: number }>(response)).toMatchObject({
        id: roleId,
        userCount: 1,
        holdersRestored: 1,
      });
      await request(http).get('/audit-logs').set(auth(token)).expect(200);
      const [row] = await db.select().from(roles).where(eq(roles.id, roleId));
      expect(row?.deletedAt).toBeNull();
      expect(row?.updatedBy).toBe(rootId);

      const audit = await auditOf(roleId, 'role.restore');
      expect(audit).toMatchObject({ actorId: rootId, resourceType: 'role' });
      expect(audit?.metadata).toMatchObject({ holdersRestored: 1 });
      expect(await holderEdges(roleId)).toEqual([holder, gone].toSorted());
    });

    it('R3 之前刪除的角色（沒有持有者邊）還原後沒有持有者：holdersRestored 是 0', async () => {
      const roleId = await createRole('舊的刪除 C', ['auditLog:read']);
      await createUser('legacy-c@example.com', [roleId]);
      await deleteRole(roleId).expect(204);
      // 模擬舊版程式的刪除：持有者邊已被硬刪除
      await db
        .delete(relationTuples)
        .where(and(isRoleHolderTuple(), eq(relationTuples.objectId, roleId)));

      const response = await restoreRole(roleId).expect(200);
      expect(dataOf<{ holdersRestored: number }>(response).holdersRestored).toBe(0);
      expect((await auditOf(roleId, 'role.restore'))?.metadata).toMatchObject({
        holdersRestored: 0,
      });
    });

    it('名稱已被新角色使用 → 409 ROLE_NAME_DUPLICATE，details.conflictingRoleId 是新角色，仍維持刪除', async () => {
      const old = await createRole('撞名 D', ['auditLog:read']);
      await deleteRole(old).expect(204);
      const replacement = await createRole('撞名 d', []);

      const response = await restoreRole(old).expect(409);
      expect(response.body).toMatchObject({
        error: {
          code: 'ROLE_NAME_DUPLICATE',
          details: { field: 'name', conflictingRoleId: replacement },
        },
      });
      const [row] = await db.select().from(roles).where(eq(roles.id, old));
      expect(row?.deletedAt).not.toBeNull();
    });

    it('slug 已被新角色使用（名稱不同）→ 409 ROLE_NAME_DUPLICATE，field 是 slug', async () => {
      const old = await createRole('Slug E', []);
      await deleteRole(old).expect(204);
      const replacement = await createRole('Slug-E', []);
      const [taken] = await db.select().from(roles).where(eq(roles.id, replacement));
      expect(taken?.slug).toBe('slug-e');

      const response = await restoreRole(old).expect(409);
      expect(response.body).toMatchObject({
        error: {
          code: 'ROLE_NAME_DUPLICATE',
          details: { field: 'slug', value: 'slug-e', conflictingRoleId: replacement },
        },
      });
    });

    it('反提權：角色帶了 actor 沒有的權限鍵 → 403 AUTHZ_ESCALATION，仍維持刪除', async () => {
      const managerRole = await createRole('只能刪角色 F', ['role:read', 'role:delete']);
      await createUser('manager-f@example.com', [managerRole]);
      const managerToken = await login('manager-f@example.com');
      const target = await createRole('稽核檢視 F', ['auditLog:read']);
      await deleteRole(target).expect(204);

      const response = await restoreRole(target, managerToken).expect(403);
      expect(response.body).toMatchObject({
        error: { code: 'AUTHZ_ESCALATION', details: { missing: ['auditLog:read'] } },
      });
      const [row] = await db.select().from(roles).where(eq(roles.id, target));
      expect(row?.deletedAt).not.toBeNull();

      // 同一個人還原只帶自己有的鍵的角色沒問題
      const harmless = await createRole('只能讀角色 F', ['role:read']);
      await deleteRole(harmless).expect(204);
      await restoreRole(harmless, managerToken).expect(200);
    });

    it('沒有被刪除 → 409 ROLE_NOT_DELETED；不存在 → 404 ROLE_NOT_FOUND', async () => {
      const live = await restoreRole(await roleIdOf('member')).expect(409);
      expect(live.body).toMatchObject({ error: { code: 'ROLE_NOT_DELETED' } });

      const missing = await restoreRole(randomUUID()).expect(404);
      expect(missing.body).toMatchObject({ error: { code: 'ROLE_NOT_FOUND' } });
    });

    it('沒有 role:delete（auditor）→ 403 AUTHZ_FORBIDDEN', async () => {
      const roleId = await createRole('權限 G', []);
      await deleteRole(roleId).expect(204);
      await createUser('auditor-g@example.com', [await roleIdOf('auditor')]);
      const response = await restoreRole(roleId, await login('auditor-g@example.com')).expect(403);
      expect(response.body).toMatchObject({ error: { code: 'AUTHZ_FORBIDDEN' } });
    });
  });

  describe('GET /trash?type=role', () => {
    it('只列已刪除的角色，新刪除的在前，帶說明與刪除者', async () => {
      const first = await createRole('回收 H1', []);
      const second = await createRole('回收 H2', []);
      await db.update(roles).set({ description: '第二個' }).where(eq(roles.id, second));
      await createRole('回收 H-live', []);
      await deleteRole(first).expect(204);
      await deleteRole(second).expect(204);

      const response = await request(http)
        .get('/trash')
        .query({ type: 'role', keyword: '回收 H' })
        .set(auth())
        .expect(200);
      const { items } = dataOf<{
        items: Array<{ id: string; type: string; description: string | null; deletedBy: unknown }>;
      }>(response);
      expect(items.map((item) => item.id)).toEqual([second, first]);
      expect(items[0]).toMatchObject({
        type: 'role',
        name: '回收 H2',
        description: '第二個',
        deletedBy: { id: rootId },
      });
    });

    it('只有 user:delete 的人看 type=role → 403；有 role:delete 的人 → 200', async () => {
      const userDeleter = await createRole('只能刪使用者 I', ['user:read', 'user:delete']);
      await createUser('user-deleter-i@example.com', [userDeleter]);
      const token = await login('user-deleter-i@example.com');
      await request(http).get('/trash').query({ type: 'role' }).set(auth(token)).expect(403);
      await request(http).get('/trash').query({ type: 'user' }).set(auth(token)).expect(200);

      const roleDeleter = await createRole('只能刪角色 I', ['role:read', 'role:delete']);
      await createUser('role-deleter-i@example.com', [roleDeleter]);
      const roleToken = await login('role-deleter-i@example.com');
      await request(http).get('/trash').query({ type: 'role' }).set(auth(roleToken)).expect(200);
    });
  });

  describe('trash.purge（角色）', () => {
    beforeEach(async () => {
      // 其他案例留在回收桶裡的角色與使用者不影響斷言：先把它們都移回保留期限內
      await db.update(roles).set({ deletedAt: new Date() }).where(isNotNull(roles.deletedAt));
      await db.update(users).set({ deletedAt: new Date() }).where(isNotNull(users.deletedAt));
    });

    it('超過保留期限的角色硬刪除：持有者、權限鍵、資料夾授權的邊一併清掉，寫 role.purge 稽核', async () => {
      const expired = await createRole('到期 J', ['auditLog:read']);
      const holder = await createUser('purge-j@example.com', [expired]);
      const folderId = randomUUID();
      await db.insert(relationTuples).values({
        objectType: 'fileFolder',
        objectId: folderId,
        relation: 'viewer',
        subjectType: ROLE_OBJECT_TYPE,
        subjectId: expired,
        subjectRelation: ROLE_HOLDER_RELATION,
      });
      await deleteRole(expired).expect(204);
      await db
        .update(roles)
        .set({ deletedAt: new Date(Date.now() - 31 * DAY_MS) })
        .where(eq(roles.id, expired));

      const recent = await createRole('未到期 J', []);
      await deleteRole(recent).expect(204);

      const report = await purge();
      expect(report).toMatchObject({ retentionDays: 30, purged: { role: 1 } });

      expect(await db.select().from(roles).where(eq(roles.id, expired))).toHaveLength(0);
      const edges = await db
        .select()
        .from(relationTuples)
        .where(
          or(
            and(
              eq(relationTuples.objectType, ROLE_OBJECT_TYPE),
              eq(relationTuples.objectId, expired),
            ),
            and(
              eq(relationTuples.subjectType, ROLE_OBJECT_TYPE),
              eq(relationTuples.subjectId, expired),
            ),
          ),
        );
      expect(edges).toHaveLength(0);
      expect(await db.select().from(users).where(eq(users.id, holder))).toHaveLength(1);
      expect(await db.select().from(roles).where(eq(roles.id, recent))).toHaveLength(1);

      const audit = await auditOf(expired, 'role.purge');
      expect(audit).toMatchObject({
        actorId: null,
        actorEmail: 'system',
        resourceType: 'role',
        resourceName: '到期 J',
      });
      expect(audit?.metadata).toMatchObject({ retentionDays: 30 });
    });
  });
});
