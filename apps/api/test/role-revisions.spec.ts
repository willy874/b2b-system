import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import type { Response } from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { TENANT_DB, withTransaction } from '@/core/database';
import type { Database } from '@/core/database';
import {
  auditLogs,
  relationTuples,
  revisions,
  roleHolderTuple,
  rolePermissionTuple,
  roles,
  users,
} from '@/db/schema';
import { hashPassword } from '@/modules/credential/password';
import { RevisionService } from '@/modules/revision/revision.service';
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

const ROOT = { email: 'revision-root@example.com', password: 'RootPassword!2026' };
const PASSWORD = 'RevisionPassword!2026';
const DAY_MS = 24 * 60 * 60 * 1000;

interface Snapshot {
  name: string;
  description: string | null;
  permissionKeys: string[];
}

interface RevisionSummary {
  version: number;
  actor: { id: string; name: string } | null;
  tooLarge: boolean;
}

function dataOf<T>(response: Response): T {
  return (response.body as { data: T }).data;
}

function auth(token = rootToken) {
  return { authorization: `Bearer ${token}` };
}

async function createRole(
  name: string,
  permissionKeys: string[],
  description?: string,
): Promise<string> {
  const response = await request(http)
    .post('/roles')
    .set(auth())
    .send({ name, permissionKeys, ...(description && { description }) })
    .expect(201);
  return dataOf<{ id: string }>(response).id;
}

/** 直接寫 DB 建立一位 active 的使用者並持有指定的角色，回傳 access token。 */
async function tokenWithRole(email: string, roleIds: string[]): Promise<string> {
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
  const response = await request(http)
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  return dataOf<{ accessToken: string }>(response).accessToken;
}

/** 資料庫裡某個角色的版本（舊的在前）。 */
async function revisionRows(roleId: string) {
  return db
    .select()
    .from(revisions)
    .where(and(eq(revisions.resourceType, 'role'), eq(revisions.resourceId, roleId)))
    .orderBy(asc(revisions.version));
}

async function roleVersion(roleId: string): Promise<number> {
  const [row] = await db.select({ version: roles.version }).from(roles).where(eq(roles.id, roleId));
  return row!.version;
}

function revert(roleId: string, version: number, body: { version: number }, token = rootToken) {
  return request(http)
    .post(`/roles/${roleId}/revisions/${version}/revert`)
    .set(auth(token))
    .send(body);
}

function grantPermissions(roleId: string, add: string[], remove: string[] = []) {
  return request(http)
    .patch(`/roles/${roleId}/permissions`)
    .set(auth())
    .send({ add, remove })
    .expect(200);
}

describe('角色的版本歷史（docs/architecture/backend/14-revisions.md、docs/architecture/backend/14-revisions.md §9.2 D1、R5）', () => {
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

    const login = await request(http).post('/auth/login').send(ROOT).expect(200);
    rootToken = dataOf<{ accessToken: string }>(login).accessToken;
    const [root] = await db.select().from(users).where(eq(users.email, ROOT.email));
    rootId = root!.id;
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    delete process.env.AUTH_RATE_LIMIT;
  });

  describe('寫入時記錄（同一個交易）', () => {
    it('建立、改名稱與說明、改權限鍵各產生一版；權限鍵的變更不遞增角色的 version', async () => {
      const id = await createRole('版本 A', ['user:read', 'auditLog:read']);
      await request(http)
        .patch(`/roles/${id}`)
        .set(auth())
        .send({ name: '版本 A2', description: '說明', version: await roleVersion(id) })
        .expect(200);
      expect(await roleVersion(id)).toBe(2);
      await grantPermissions(id, ['role:read'], ['user:read']);
      expect(await roleVersion(id)).toBe(2);

      const rows = await revisionRows(id);
      expect(rows.map((row) => row.version)).toEqual([1, 2, 3]);
      expect(rows.map((row) => row.actorId)).toEqual([rootId, rootId, rootId]);
      expect(rows.map((row) => row.snapshot)).toEqual([
        { name: '版本 A', description: null, permissionKeys: ['auditLog:read', 'user:read'] },
        { name: '版本 A2', description: '說明', permissionKeys: ['auditLog:read', 'user:read'] },
        { name: '版本 A2', description: '說明', permissionKeys: ['auditLog:read', 'role:read'] },
      ]);
    });

    it('複製角色也產生第 1 版（複製到的鍵）', async () => {
      const source = await createRole('範本 B', ['user:read']);
      const response = await request(http)
        .post(`/roles/${source}/duplicate`)
        .set(auth())
        .send({ name: '複本 B' })
        .expect(201);
      const copy = dataOf<{ id: string }>(response).id;
      const rows = await revisionRows(copy);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.snapshot).toMatchObject({ name: '複本 B', permissionKeys: ['user:read'] });
    });

    it('交易 rollback 時版本也不留下（與業務寫入同生共死）', async () => {
      const id = await createRole('回滾 C', []);
      const service = app.get(RevisionService);
      const tenantDb = await inTestTenant(app, async () => app.get<Database>(TENANT_DB));
      await expect(
        inTestTenant(app, () =>
          withTransaction(tenantDb, async (tx) => {
            await service.record(tx, {
              resourceType: 'role',
              resourceId: id,
              snapshot: { name: 'x', description: null, permissionKeys: [] },
              actorId: rootId,
            });
            throw new Error('業務寫入失敗');
          }),
        ),
      ).rejects.toThrow('業務寫入失敗');
      expect((await revisionRows(id)).map((row) => row.version)).toEqual([1]);
    });

    it('快照超過 1 MiB：業務寫入照常成功，那一版 snapshot 為 null 並記 warn；列表標 tooLarge、還原 409', async () => {
      const id = await createRole('過大 D', []);
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      const version = await inTestTenant(app, () =>
        app.get(RevisionService).record(db as never, {
          resourceType: 'role',
          resourceId: id,
          snapshot: { name: '過大 D', description: 'x'.repeat(1024 * 1024), permissionKeys: [] },
          actorId: rootId,
        }),
      );
      expect(version).toBe(2);
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ resourceType: 'role', resourceId: id, version: 2 }),
        '版本快照超過上限，這一版不保存內容',
      );
      warn.mockRestore();
      expect((await revisionRows(id))[1]?.snapshot).toBeNull();

      const list = await request(http).get(`/roles/${id}/revisions`).set(auth()).expect(200);
      expect(dataOf<{ items: RevisionSummary[] }>(list).items.map((item) => item.tooLarge)).toEqual(
        [true, false],
      );
      const detail = await request(http).get(`/roles/${id}/revisions/2`).set(auth()).expect(200);
      expect(dataOf<{ snapshot: unknown }>(detail).snapshot).toBeNull();

      const response = await revert(id, 2, { version: await roleVersion(id) }).expect(409);
      expect(response.body).toMatchObject({
        error: { code: 'REVISION_UNAVAILABLE', details: { version: 2, reason: 'tooLarge' } },
      });
    });
  });

  describe('讀取', () => {
    it('GET /roles/:id/revisions：新的在前、分頁、帶作者；GET /:version 帶快照', async () => {
      const id = await createRole('讀取 E', ['user:read']);
      await request(http)
        .patch(`/roles/${id}`)
        .set(auth())
        .send({ description: '一', version: 1 })
        .expect(200);
      await request(http)
        .patch(`/roles/${id}`)
        .set(auth())
        .send({ description: '二', version: 2 })
        .expect(200);

      const page = await request(http)
        .get(`/roles/${id}/revisions`)
        .query({ offset: 0, limit: 2 })
        .set(auth())
        .expect(200);
      const body = dataOf<{ items: RevisionSummary[]; pagination: { total: number } }>(page);
      expect(body.pagination.total).toBe(3);
      expect(body.items.map((item) => item.version)).toEqual([3, 2]);
      expect(body.items[0]?.actor).toEqual({ id: rootId, name: expect.any(String) });

      const detail = await request(http).get(`/roles/${id}/revisions/1`).set(auth()).expect(200);
      expect(dataOf<{ version: number; snapshot: Snapshot }>(detail)).toMatchObject({
        version: 1,
        snapshot: { name: '讀取 E', description: null, permissionKeys: ['user:read'] },
      });
    });

    it('不存在的版本 → 404 REVISION_NOT_FOUND；已刪除的角色 → 404 ROLE_NOT_FOUND', async () => {
      const id = await createRole('讀取 F', []);
      const missing = await request(http).get(`/roles/${id}/revisions/99`).set(auth()).expect(404);
      expect(missing.body).toMatchObject({ error: { code: 'REVISION_NOT_FOUND' } });

      await request(http).delete(`/roles/${id}?force=true`).set(auth()).expect(204);
      const deleted = await request(http).get(`/roles/${id}/revisions`).set(auth()).expect(404);
      expect(deleted.body).toMatchObject({ error: { code: 'ROLE_NOT_FOUND' } });
    });

    it('權限：role:read 看得到；沒有 role:read → 403', async () => {
      const id = await createRole('讀取 G', []);
      const reader = await tokenWithRole('reader-g@example.com', [
        await createRole('只能讀角色 G', ['role:read']),
      ]);
      await request(http).get(`/roles/${id}/revisions`).set(auth(reader)).expect(200);
      await request(http).get(`/roles/${id}/revisions/1`).set(auth(reader)).expect(200);

      const outsider = await tokenWithRole('outsider-g@example.com', [
        await createRole('只能讀使用者 G', ['user:read']),
      ]);
      const denied = await request(http)
        .get(`/roles/${id}/revisions`)
        .set(auth(outsider))
        .expect(403);
      expect(denied.body).toMatchObject({ error: { code: 'AUTHZ_FORBIDDEN' } });
    });
  });

  describe('POST /roles/:id/revisions/:version/revert', () => {
    it('套回名稱、說明與權限鍵：角色 version + 1、產生新的一版、稽核 role.update 帶 revertedFrom', async () => {
      const id = await createRole('還原 H', ['user:read'], '原本');
      await request(http)
        .patch(`/roles/${id}`)
        .set(auth())
        .send({ name: '還原 H 改', description: null, version: await roleVersion(id) })
        .expect(200);
      await grantPermissions(id, ['auditLog:read'], ['user:read']);
      const before = await roleVersion(id);

      const response = await revert(id, 1, { version: before }).expect(200);
      expect(
        dataOf<{ name: string; description: string; version: number }>(response),
      ).toMatchObject({ name: '還原 H', description: '原本', version: before + 1 });
      const rows = await revisionRows(id);
      expect(rows.map((row) => row.version)).toEqual([1, 2, 3, 4]);
      expect(rows[3]?.snapshot).toEqual(rows[0]?.snapshot);

      const [audit] = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.resourceId, id), eq(auditLogs.action, 'role.update')))
        .orderBy(desc(auditLogs.id))
        .limit(1);
      expect(audit?.metadata).toMatchObject({ revertedFrom: 1 });
      expect(audit?.changes).toMatchObject({
        before: { name: '還原 H 改', description: null, permissions: ['auditLog:read'] },
        after: { name: '還原 H', description: '原本', permissions: ['user:read'] },
      });
    });

    it('持有者的權限立刻跟著還原（permissionsChanged）', async () => {
      const id = await createRole('生效 I', ['auditLog:read']);
      const holder = await tokenWithRole('holder-i@example.com', [id]);
      await request(http).get('/audit-logs').set(auth(holder)).expect(200);
      await grantPermissions(id, [], ['auditLog:read']);
      await request(http).get('/audit-logs').set(auth(holder)).expect(403);

      await revert(id, 1, { version: await roleVersion(id) }).expect(200);
      await request(http).get('/audit-logs').set(auth(holder)).expect(200);
    });

    it('樂觀鎖：帶過時的 version → 409 ROLE_VERSION_CONFLICT（details.current），沒有新的一版', async () => {
      const id = await createRole('衝突 J', []);
      await request(http)
        .patch(`/roles/${id}`)
        .set(auth())
        .send({ description: '改', version: 1 })
        .expect(200);

      const response = await revert(id, 1, { version: 1 }).expect(409);
      expect(response.body).toMatchObject({
        error: { code: 'ROLE_VERSION_CONFLICT', details: { current: 2 } },
      });
      expect(await revisionRows(id)).toHaveLength(2);
    });

    it('不帶 version → 400 VALIDATION_FAILED（docs/architecture/backend/14-revisions.md §9.2 D4 的 R1b：必填），沒有新的一版', async () => {
      const id = await createRole('必填 J2', []);
      const response = await request(http)
        .post(`/roles/${id}/revisions/1/revert`)
        .set(auth())
        .send({})
        .expect(400);
      expect(response.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
      expect(await revisionRows(id)).toHaveLength(1);
    });

    it('反提權：加回 actor 沒有的鍵 → 403 AUTHZ_ESCALATION，角色與版本都不變', async () => {
      const target = await createRole('提權 K', ['auditLog:read']);
      await grantPermissions(target, [], ['auditLog:read']);
      const manager = await tokenWithRole('manager-k@example.com', [
        await createRole('角色管理 K', ['role:read', 'role:update', 'role:grantPermission']),
      ]);

      const response = await revert(
        target,
        1,
        { version: await roleVersion(target) },
        manager,
      ).expect(403);
      expect(response.body).toMatchObject({
        error: { code: 'AUTHZ_ESCALATION', details: { missing: ['auditLog:read'] } },
      });
      expect(await revisionRows(target)).toHaveLength(2);
      expect(await roleVersion(target)).toBe(1);
    });

    it('權限鍵會改變時要 role:grantPermission；只改名稱與說明時 role:update 就夠', async () => {
      const editor = await tokenWithRole('editor-l@example.com', [
        await createRole('角色編輯 L', ['role:read', 'role:update']),
      ]);
      const keys = await createRole('鍵 L', ['user:read']);
      await grantPermissions(keys, [], ['user:read']);
      const denied = await revert(keys, 1, { version: await roleVersion(keys) }, editor).expect(
        403,
      );
      expect(denied.body).toMatchObject({
        error: { code: 'AUTHZ_FORBIDDEN', details: { required: ['role:grantPermission'] } },
      });

      const named = await createRole('名稱 L', []);
      await request(http)
        .patch(`/roles/${named}`)
        .set(auth())
        .send({ name: '名稱 L2', version: await roleVersion(named) })
        .expect(200);
      const ok = await revert(named, 1, { version: await roleVersion(named) }, editor).expect(200);
      expect(dataOf<{ name: string }>(ok).name).toBe('名稱 L');
    });

    it('沒有 role:update（auditor）→ 403；super-admin 角色 → 403 ROLE_SUPER_ADMIN_IMMUTABLE', async () => {
      const id = await createRole('權限 M', []);
      const [auditorRole] = await db.select().from(roles).where(eq(roles.slug, 'auditor'));
      const auditor = await tokenWithRole('auditor-m@example.com', [auditorRole!.id]);
      await revert(id, 1, { version: await roleVersion(id) }, auditor).expect(403);

      const [superAdmin] = await db.select().from(roles).where(eq(roles.slug, 'super-admin'));
      const response = await revert(superAdmin!.id, 1, {
        version: await roleVersion(superAdmin!.id),
      }).expect(403);
      expect(response.body).toMatchObject({ error: { code: 'ROLE_SUPER_ADMIN_IMMUTABLE' } });
    });

    it('名稱已被別的角色使用 → 409 ROLE_NAME_DUPLICATE', async () => {
      const id = await createRole('撞名 N', []);
      await request(http)
        .patch(`/roles/${id}`)
        .set(auth())
        .send({ name: '撞名 N2', version: 1 })
        .expect(200);
      await createRole('撞名 N', []);
      const response = await revert(id, 1, { version: await roleVersion(id) }).expect(409);
      expect(response.body).toMatchObject({ error: { code: 'ROLE_NAME_DUPLICATE' } });
    });

    it('目錄裡已不存在的鍵略過，記在 metadata.skippedPermissions', async () => {
      const id = await createRole('舊鍵 O', ['user:read']);
      await db
        .update(revisions)
        .set({
          snapshot: {
            name: '舊鍵 O',
            description: null,
            permissionKeys: ['legacy:gone', 'user:read'],
          },
        })
        .where(and(eq(revisions.resourceId, id), eq(revisions.version, 1)));
      await grantPermissions(id, [], ['user:read']);

      await revert(id, 1, { version: await roleVersion(id) }).expect(200);
      const [audit] = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.resourceId, id), eq(auditLogs.action, 'role.update')))
        .orderBy(desc(auditLogs.id))
        .limit(1);
      expect(audit?.metadata).toMatchObject({
        revertedFrom: 1,
        skippedPermissions: ['legacy:gone'],
      });
      expect((await revisionRows(id)).at(-1)?.snapshot).toMatchObject({
        permissionKeys: ['user:read'],
      });
    });
  });

  describe('保留與清除', () => {
    /** 直接寫入某個資源的版本 1..count，`oldCount` 之前的都是 `daysAgo` 天前寫的。 */
    async function seedRevisions(count: number, oldCount: number, daysAgo: number) {
      const resourceId = randomUUID();
      const old = new Date(Date.now() - daysAgo * DAY_MS);
      await db.insert(revisions).values(
        Array.from({ length: count }, (_, index) => ({
          resourceType: 'role',
          resourceId,
          version: index + 1,
          snapshot: { index },
          createdAt: index < oldCount ? old : new Date(),
        })),
      );
      return resourceId;
    }

    async function versionsOf(resourceId: string): Promise<number[]> {
      const rows = await db
        .select({ version: revisions.version })
        .from(revisions)
        .where(eq(revisions.resourceId, resourceId))
        .orderBy(asc(revisions.version));
      return rows.map((row) => row.version);
    }

    it('revision.prune 保留「最新 N 版」∪「N 天內」，其餘刪除', async () => {
      // 60 版：前 55 版是 100 天前的 → 最新 50 版（11～60）留下，1～10 刪除
      const many = await seedRevisions(60, 55, 100);
      // 3 版都很舊，但都在最新 50 版內 → 全部留下
      const few = await seedRevisions(3, 3, 100);
      // 60 版都在 90 天內 → 全部留下
      const recent = await seedRevisions(60, 60, 10);

      const report = await inTestTenant(app, () => app.get(RevisionService).prune());
      expect(report).toMatchObject({ keepVersions: 50, keepDays: 90 });
      expect(await versionsOf(many)).toEqual(Array.from({ length: 50 }, (_, index) => index + 11));
      expect(await versionsOf(few)).toEqual([1, 2, 3]);
      expect(await versionsOf(recent)).toHaveLength(60);
    });

    it('保留條件依系統設定 revision.keepVersions／revision.keepDays', async () => {
      const id = await seedRevisions(5, 5, 20);
      await request(http)
        .patch('/system/settings')
        .set(auth())
        .send({ values: { 'revision.keepVersions': 2, 'revision.keepDays': 7 } })
        .expect(200);

      const report = await inTestTenant(app, () => app.get(RevisionService).prune());
      expect(report).toMatchObject({ keepVersions: 2, keepDays: 7 });
      expect(await versionsOf(id)).toEqual([4, 5]);

      await request(http)
        .patch('/system/settings')
        .set(auth())
        .send({ values: { 'revision.keepVersions': null, 'revision.keepDays': null } })
        .expect(200);
    });

    it('永久刪除角色（trash.purge）時一起刪掉它的版本', async () => {
      const id = await createRole('清除 P', []);
      await request(http)
        .patch(`/roles/${id}`)
        .set(auth())
        .send({ description: '改', version: 1 })
        .expect(200);
      await request(http).delete(`/roles/${id}?force=true`).set(auth()).expect(204);
      await db
        .update(roles)
        .set({ deletedAt: new Date(Date.now() - 40 * DAY_MS) })
        .where(eq(roles.id, id));
      expect(await revisionRows(id)).toHaveLength(2);

      const report = await inTestTenant(app, () => app.get(TrashService).purgeExpired());
      expect(report.purged.role).toBeGreaterThanOrEqual(1);
      expect(await revisionRows(id)).toEqual([]);
    });
  });

  describe('基準版本（migration 0014）', () => {
    it('以 migration 當下的名稱、說明與權限鍵為每個角色寫第 1 版（與 toRoleRevision 同一個形狀）', async () => {
      const [role] = await db
        .insert(roles)
        .values({ slug: 'baseline-q', name: '基準 Q', description: '舊資料' })
        .returning();
      await db
        .insert(relationTuples)
        .values(
          ['user:read', 'auditLog:read', 'role:read'].map((key) =>
            rolePermissionTuple(role!.id, key),
          ),
        );
      const migration = readFileSync(
        resolve(__dirname, '../src/db/migrations/0014_revisions.sql'),
        'utf8',
      );
      const backfill = migration.slice(migration.indexOf('INSERT INTO "revisions"'));
      await db.execute(sql.raw(backfill));
      // 冪等：已有第 1 版的角色不重複寫
      await db.execute(sql.raw(backfill));

      const rows = await revisionRows(role!.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        version: 1,
        actorId: null,
        snapshot: {
          name: '基準 Q',
          description: '舊資料',
          permissionKeys: ['auditLog:read', 'role:read', 'user:read'],
        },
      });

      // 之後的寫入接在基準版本之後
      await request(http)
        .patch(`/roles/${role!.id}`)
        .set(auth())
        .send({ name: '基準 Q2', version: await roleVersion(role!.id) })
        .expect(200);
      expect((await revisionRows(role!.id)).map((row) => row.version)).toEqual([1, 2]);
    });

    it('seed 建立的系統角色有第 1 版（actor 為 null）', async () => {
      const [member] = await db.select().from(roles).where(eq(roles.slug, 'member'));
      const rows = await revisionRows(member!.id);
      expect(rows[0]).toMatchObject({ version: 1, actorId: null });
    });
  });
});
