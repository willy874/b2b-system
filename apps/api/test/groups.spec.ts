import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuthzService } from '@/core/authz';
import {
  authzRevision,
  groupMemberTuple,
  groupRoleTuple,
  groups,
  relationTuples,
  roleHolderTuple,
  rolePermissionTuple,
  roles,
  users,
} from '@/db/schema';
import { PermissionService } from '@/modules/permission/permission.service';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { inTestTenant } from './tenant';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;

const SUPER_ADMIN = { email: 'root@example.com', password: 'Quiet-Harbor-Lantern-26' };
const ADMIN = { email: 'group-admin@example.com', password: 'AdminPassword!2026' };
const MANAGER = { email: 'group-manager@example.com', password: 'ManagerPassword!2026' };
const ALICE = { email: 'alice@example.com', password: 'AlicePassword!2026' };
const BOB = { email: 'bob@example.com', password: 'BobPassword!2026' };

const ids: Record<string, string> = {};
const tokenCache = new Map<string, string>();

async function login(credentials: { email: string; password: string }): Promise<string> {
  const cached = tokenCache.get(credentials.email);
  if (cached) return cached;
  const response = await request(http).post('/auth/login').send(credentials).expect(200);
  const token = (response.body as { data: { accessToken: string } }).data.accessToken;
  tokenCache.set(credentials.email, token);
  return token;
}

async function createActiveUser(email: string, password: string): Promise<string> {
  const { hashPassword } = await import('@/modules/credential/password');
  const [user] = await db
    .insert(users)
    .values({
      email,
      displayName: email,
      passwordHash: await hashPassword(password),
      status: 'active',
    })
    .returning();
  return user!.id;
}

async function createRole(slug: string, keys: string[]): Promise<string> {
  const [role] = await db.insert(roles).values({ slug, name: slug, isSystem: false }).returning();
  if (keys.length)
    await db.insert(relationTuples).values(keys.map((key) => rolePermissionTuple(role!.id, key)));
  return role!.id;
}

/** 直接寫 DB 建立一個群組：持有 `roleIds`，成員是 `userIds`。 */
async function createGroupHolding(
  name: string,
  roleIds: string[],
  userIds: string[],
): Promise<string> {
  const [group] = await db.insert(groups).values({ name }).returning();
  await db
    .insert(relationTuples)
    .values([
      ...roleIds.map((roleId) => groupRoleTuple(roleId, group!.id)),
      ...userIds.map((id) => groupMemberTuple(group!.id, { type: 'user', id })),
    ]);
  return group!.id;
}

async function permissionsOf(credentials: { email: string; password: string }): Promise<string[]> {
  const response = await request(http)
    .get('/auth/profile')
    .set('authorization', `Bearer ${await login(credentials)}`)
    .expect(200);
  return (response.body as { data: { permissions: string[] } }).data.permissions;
}

async function as(credentials: { email: string; password: string }) {
  const token = await login(credentials);
  return {
    get: (path: string) => request(http).get(path).set('authorization', `Bearer ${token}`),
    post: (path: string, body?: object) =>
      request(http).post(path).set('authorization', `Bearer ${token}`).send(body),
    patch: (path: string, body: object) =>
      request(http).patch(path).set('authorization', `Bearer ${token}`).send(body),
    put: (path: string, body: object) =>
      request(http).put(path).set('authorization', `Bearer ${token}`).send(body),
    delete: (path: string) => request(http).delete(path).set('authorization', `Bearer ${token}`),
  };
}

async function revision(): Promise<number> {
  const [row] = await db.select().from(authzRevision);
  return row?.revision ?? 0;
}

describe('群組（docs/architecture/iam/01-model.md §9.3 D11、D12）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN.email;
    process.env.SUPER_ADMIN_PASSWORD = SUPER_ADMIN.password;
    process.env.PERMISSION_CACHE_TTL = '60';

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);

    const [admin] = await db.select().from(roles).where(eq(roles.slug, 'admin'));
    ids.adminRole = admin!.id;
    const [superAdmin] = await db.select().from(roles).where(eq(roles.slug, 'super-admin'));
    ids.superAdminRole = superAdmin!.id;
    // 美術組要的能力：只有 system:update（admin 沒有，用來驗證反提權）與 file:update
    ids.editorRole = await createRole('file-editor', ['file:update']);
    ids.settingsRole = await createRole('settings-editor', ['system:update']);
    // 群組管理者：能管群組成員，但沒有 system:update
    ids.managerRole = await createRole('group-manager', ['group:update', 'file:update']);

    ids.admin = await createActiveUser(ADMIN.email, ADMIN.password);
    await db.insert(relationTuples).values(roleHolderTuple(ids.adminRole, ids.admin));
    ids.manager = await createActiveUser(MANAGER.email, MANAGER.password);
    await db.insert(relationTuples).values(roleHolderTuple(ids.managerRole, ids.manager));
    ids.alice = await createActiveUser(ALICE.email, ALICE.password);

    const { AppModule } = await import('@/app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    http = await listenOnLoopback(app);
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('建立群組；名稱不分大小寫唯一', async () => {
    const admin = await as(ADMIN);
    const art = await admin.post('/groups', { name: '美術' }).expect(201);
    ids.art = (art.body as { data: { id: string } }).data.id;
    const design = await admin.post('/groups', { name: 'Design' }).expect(201);
    ids.design = (design.body as { data: { id: string } }).data.id;
    const duplicate = await admin.post('/groups', { name: 'design' }).expect(409);
    expect(duplicate.body.error.code).toBe('GROUP_NAME_DUPLICATE');
  });

  it('群組持有角色、成員取得角色的權限；移出後下一個請求就沒有', async () => {
    const admin = await as(ADMIN);
    expect(await permissionsOf(ALICE)).not.toContain('file:update');

    const held = await admin
      .patch(`/groups/${ids.art}/roles`, { add: [ids.editorRole] })
      .expect(200);
    expect(held.body.data.roles.map((role: { id: string }) => role.id)).toEqual([ids.editorRole]);
    await admin
      .patch(`/groups/${ids.art}/members`, { add: [{ type: 'user', id: ids.alice }] })
      .expect(200);
    expect(await permissionsOf(ALICE)).toContain('file:update');

    await admin
      .patch(`/groups/${ids.art}/members`, { remove: [{ type: 'user', id: ids.alice }] })
      .expect(200);
    expect(await permissionsOf(ALICE)).not.toContain('file:update');
  });

  it('巢狀：alice ∈ Design ∈ 美術 → 取得美術持有的角色；反向查詢也找得到她', async () => {
    const admin = await as(ADMIN);
    await admin
      .patch(`/groups/${ids.art}/members`, { add: [{ type: 'group', id: ids.design }] })
      .expect(200);
    await admin
      .patch(`/groups/${ids.design}/members`, { add: [{ type: 'user', id: ids.alice }] })
      .expect(200);
    expect(await permissionsOf(ALICE)).toContain('file:update');

    const members = await admin.get(`/groups/${ids.art}/members`).expect(200);
    expect(members.body.data.items).toEqual([
      expect.objectContaining({ type: 'group', id: ids.design, name: 'Design', email: null }),
    ]);

    const holders = await inTestTenant(app, () =>
      app.get(PermissionService).findActiveUserIdsWithPermission('file:update'),
    );
    expect(holders).toContain(ids.alice);
  });

  it('形成循環 → 409 GROUP_MEMBERSHIP_CYCLE', async () => {
    const admin = await as(ADMIN);
    const response = await admin
      .patch(`/groups/${ids.design}/members`, { add: [{ type: 'group', id: ids.art }] })
      .expect(409);
    expect(response.body.error.code).toBe('GROUP_MEMBERSHIP_CYCLE');
  });

  it('刪除群組：成員失去權限、revision +1；還原後回來', async () => {
    const admin = await as(ADMIN);
    const before = await revision();
    await admin.delete(`/groups/${ids.art}`).expect(204);
    expect(await revision()).toBeGreaterThan(before);
    expect(await permissionsOf(ALICE)).not.toContain('file:update');
    await admin.get(`/groups/${ids.art}`).expect(404);
    // 回收桶的「群組」分頁（GroupTrashHandler）
    const trash = await admin.get('/trash?type=group').expect(200);
    expect(trash.body.data.items).toEqual([expect.objectContaining({ id: ids.art, name: '美術' })]);

    const restored = await admin.post(`/groups/${ids.art}/restore`).expect(200);
    expect(restored.body.data).toMatchObject({ id: ids.art, memberCount: 1, roleCount: 1 });
    expect(await permissionsOf(ALICE)).toContain('file:update');
    const again = await admin.post(`/groups/${ids.art}/restore`).expect(409);
    expect(again.body.error.code).toBe('GROUP_NOT_DELETED');
  });

  it('群組不能持有 super-admin → 403 GROUP_SUPER_ADMIN_FORBIDDEN（即使是 super-admin 操作）', async () => {
    const root = await as(SUPER_ADMIN);
    const response = await root
      .patch(`/groups/${ids.design}/roles`, { add: [ids.superAdminRole] })
      .expect(403);
    expect(response.body.error.code).toBe('GROUP_SUPER_ADMIN_FORBIDDEN');
  });

  it('反提權：admin 沒有 system:update，不能讓群組持有帶它的角色', async () => {
    const admin = await as(ADMIN);
    const response = await admin
      .patch(`/groups/${ids.design}/roles`, { add: [ids.settingsRole] })
      .expect(403);
    expect(response.body.error).toMatchObject({
      code: 'AUTHZ_ESCALATION',
      details: { missing: ['system:update'] },
    });
  });

  it('反提權（D11）：把人放進 G 要持有 G 與上層群組的角色；沒有 system:update 的管理者加不了人', async () => {
    // Design 在美術底下；美術持有 settings-editor（system:update）→ 加進 Design 等於指派它
    const root = await as(SUPER_ADMIN);
    await root.patch(`/groups/${ids.art}/roles`, { add: [ids.settingsRole] }).expect(200);

    const manager = await as(MANAGER);
    const newcomer = await createActiveUser('newcomer@example.com', 'NewcomerPassword!2026');
    const response = await manager
      .patch(`/groups/${ids.design}/members`, { add: [{ type: 'user', id: newcomer }] })
      .expect(403);
    expect(response.body.error).toMatchObject({
      code: 'AUTHZ_ESCALATION',
      details: { missing: ['system:update'] },
    });
    // 移除不檢查反提權
    await manager
      .patch(`/groups/${ids.design}/members`, { remove: [{ type: 'user', id: ids.alice }] })
      .expect(200);
  });

  it('不能把自己放進群組 → 403 AUTHZ_SELF_MODIFY', async () => {
    const admin = await as(ADMIN);
    const response = await admin
      .patch(`/groups/${ids.design}/members`, { add: [{ type: 'user', id: ids.admin }] })
      .expect(403);
    expect(response.body.error.code).toBe('AUTHZ_SELF_MODIFY');
  });

  it('GET /groups?userId=：直接所屬與經由巢狀群組所屬；?roleId=：持有角色的群組', async () => {
    const admin = await as(ADMIN);
    // 美術（Design 的上層）已持有 admin 沒有的 system:update：由 super-admin 把 alice 放回 Design
    await (
      await as(SUPER_ADMIN)
    )
      .patch(`/groups/${ids.design}/members`, {
        add: [{ type: 'user', id: ids.alice }],
        remove: [],
      })
      .expect(200);
    const mine = await admin.get(`/groups?userId=${ids.alice}`).expect(200);
    expect(
      (mine.body.data.items as Array<{ id: string; membership: string }>)
        .map(({ id, membership }) => [id, membership])
        .toSorted(),
    ).toEqual(
      [
        [ids.art, 'nested'],
        [ids.design, 'direct'],
      ].toSorted(),
    );
    const holding = await admin.get(`/groups?roleId=${ids.editorRole}`).expect(200);
    expect(holding.body.data.items.map((group: { id: string }) => group.id)).toEqual([ids.art]);
    // 沒有篩選時不帶 membership
    const all = await admin.get('/groups').expect(200);
    expect(all.body.data.items[0]).not.toHaveProperty('membership');
  });

  it('資料夾授權給群組：成員（只有 file:access）就能讀那個資料夾', async () => {
    const admin = await as(ADMIN);
    const [member] = await db.select().from(roles).where(eq(roles.slug, 'member'));
    const bob = await createActiveUser(BOB.email, BOB.password);
    await db.insert(relationTuples).values(roleHolderTuple(member!.id, bob));
    const team = await admin.post('/groups', { name: '專案小組' }).expect(201);
    const teamId = (team.body as { data: { id: string } }).data.id;
    await admin
      .patch(`/groups/${teamId}/members`, { add: [{ type: 'user', id: bob }], remove: [] })
      .expect(200);
    const folder = await admin
      .post('/file-folders', { name: '小組資料', parentId: null })
      .expect(201);
    const folderId = (folder.body as { data: { id: string } }).data.id;

    const readable = async () => {
      const response = await (await as(BOB)).get('/file-folders').expect(200);
      return (
        response.body.data.items as Array<{ id: string; capabilities: { canRead: boolean } }>
      ).find((item) => item.id === folderId)?.capabilities.canRead;
    };
    expect(await readable()).toBe(false);

    const granted = await admin
      .put(`/file-folders/${folderId}/grants`, {
        subjectType: 'group',
        subjectId: teamId,
        level: 'viewer',
      })
      .expect(200);
    expect(granted.body.data.items).toEqual([
      expect.objectContaining({ subjectType: 'group', subjectId: teamId, subjectName: '專案小組' }),
    ]);
    expect(await readable()).toBe(true);

    // 候選對象可以搜群組
    const subjects = await admin
      .get(`/file-folders/${folderId}/grant-subjects?subjectType=group&keyword=小組`)
      .expect(200);
    expect(subjects.body.data.items).toEqual([
      expect.objectContaining({ subjectType: 'group', id: teamId, name: '專案小組' }),
    ]);
  });

  it('沒有 group:read 的人看不到群組', async () => {
    const response = await (await as(ALICE)).get('/groups').expect(403);
    expect(response.body.error.code).toBe('AUTHZ_FORBIDDEN');
  });

  it('closurePaths：每個主體附上從本人走到它的最短鏈（G4b 的說明用）', async () => {
    const closure = await inTestTenant(app, () => app.get(AuthzService).closurePaths(ids.alice!));
    expect(closure.get(`role:${ids.editorRole}#holder`)).toEqual([
      `user:${ids.alice}`,
      `group:${ids.design}#member`,
      `group:${ids.art}#member`,
      `role:${ids.editorRole}#holder`,
    ]);
    expect(closure.get(`user:${ids.alice}`)).toEqual([`user:${ids.alice}`]);
    expect(closure.get('user:*')).toEqual(['user:*']);
    // tenantSourcesOf：直接取得的權限鍵與它的鏈
    const sources = await inTestTenant(app, () =>
      app.get(AuthzService).tenantSourcesOf(ids.alice!),
    );
    expect(sources).toContainEqual({
      relation: 'file:update',
      path: closure.get(`role:${ids.editorRole}#holder`),
    });
  });

  describe('經由群組持有角色的人也算持有者（docs/architecture/backend/05-rbac.md §8.4、docs/architecture/iam/04-api.md §2.4）', () => {
    const MANAGEMENT = ['role:read', 'role:update', 'role:grantPermission'];

    it('自我鎖定：只經由群組持有 R 的管理者拿掉 R 的 role:grantPermission → 403 ROLE_SELF_LOCKOUT', async () => {
      const credentials = { email: 'lockout-group@example.com', password: 'LockoutPassword!2026' };
      const roleId = await createRole('lockout-via-group', MANAGEMENT);
      const userId = await createActiveUser(credentials.email, credentials.password);
      await createGroupHolding('鎖定：群組持有', [roleId], [userId]);

      const response = await (
        await as(credentials)
      )
        .patch(`/roles/${roleId}/permissions`, { add: [], remove: ['role:grantPermission'] })
        .expect(403);
      expect(response.body.error).toMatchObject({
        code: 'ROLE_SELF_LOCKOUT',
        details: { lost: ['role:grantPermission'] },
      });
    });

    it('自我鎖定：直接持有 R1、經由群組持有同樣權限的 R2，改 R1 → 放行（不會失去那些權限）', async () => {
      const credentials = { email: 'lockout-dual@example.com', password: 'DualPassword!2026' };
      const direct = await createRole('lockout-direct', MANAGEMENT);
      const viaGroup = await createRole('lockout-group-backup', MANAGEMENT);
      const userId = await createActiveUser(credentials.email, credentials.password);
      await db.insert(relationTuples).values(roleHolderTuple(direct, userId));
      await createGroupHolding('鎖定：備援', [viaGroup], [userId]);

      await (
        await as(credentials)
      )
        .patch(`/roles/${direct}/permissions`, { add: [], remove: ['role:grantPermission'] })
        .expect(200);
      expect(await permissionsOf(credentials)).toContain('role:grantPermission');
    });

    it('使用中：只由群組持有的角色，不帶 force 刪除 → 409 ROLE_IN_USE（userCount 含群組的成員）；帶 force 才刪得掉', async () => {
      const roleId = await createRole('held-by-group-only', ['file:read']);
      const first = await createActiveUser('in-use-1@example.com', 'InUsePassword!2026');
      const second = await createActiveUser('in-use-2@example.com', 'InUsePassword!2026');
      await createGroupHolding('使用中：群組', [roleId], [first, second]);
      const admin = await as(ADMIN);

      const response = await admin.delete(`/roles/${roleId}`).expect(409);
      expect(response.body.error).toMatchObject({
        code: 'ROLE_IN_USE',
        details: { userCount: 2 },
      });
      await admin.get(`/roles/${roleId}`).expect(200);

      await admin.delete(`/roles/${roleId}?force=true`).expect(204);
      await admin.get(`/roles/${roleId}`).expect(404);
      // 還原時回報重新取得角色的人數，同樣含群組的成員
      const restored = await admin.post(`/roles/${roleId}/restore`).expect(200);
      expect(restored.body.data).toMatchObject({ id: roleId, holdersRestored: 2 });
    });
  });
});
