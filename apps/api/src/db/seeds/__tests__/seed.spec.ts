import { and, eq, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { permissions, rolePermissions, roles, userRoles, users, workspaces } from '@/db/schema';

import type { TestDatabase } from '../../../../test/db';
import { createTestDatabase, truncateAll } from '../../../../test/db';
import { runSeed } from '../index';
import {
  PERMISSION_SEED,
  PLATFORM_PERMISSION_KEYS,
  WORKSPACE_PERMISSION_KEYS,
} from '../permissions';
import { ROLE_SEED } from '../roles';

let db: TestDatabase;
let close: () => Promise<void>;

async function tableCount(
  database: TestDatabase,
  table: 'permissions' | 'roles' | 'role_permissions' | 'users' | 'user_roles' | 'workspaces',
) {
  const [row] = await database.execute<{ total: number }>(
    sql.raw(`select count(*)::int as total from ${table}`),
  );
  return Number(row?.total ?? 0);
}

describe('db:seed（rbac/05-seed-and-bootstrap.md §8 驗收清單）', () => {
  beforeAll(async () => {
    process.env.SUPER_ADMIN_EMAIL = 'seed-admin@example.com';
    process.env.SUPER_ADMIN_PASSWORD = 'SeedPassword!2026';
    const created = createTestDatabase();
    db = created.db;
    close = async () => created.client.end();
    await truncateAll(db);
    await runSeed(db as never);
  });

  afterAll(async () => {
    await close();
  });

  it('① permissions 筆數 = PERMISSION_SEED.length（37：平台 27 ＋ 工作區 10）', async () => {
    expect(await tableCount(db, 'permissions')).toBe(PERMISSION_SEED.length);
    expect(PERMISSION_SEED.length).toBe(37);
    expect(PLATFORM_PERMISSION_KEYS).toHaveLength(27);
    expect(WORKSPACE_PERMISSION_KEYS).toHaveLength(10);
  });

  it("② 每筆 permissions.key = resource || ':' || action", async () => {
    const rows = await db.select().from(permissions);
    for (const row of rows) expect(row.key).toBe(`${row.resource}:${row.action}`);
  });

  it('③ roles 中恰有 7 筆 is_system = true（平台 4 ＋ 工作區 3）', async () => {
    const rows = await db.select().from(roles).where(eq(roles.isSystem, true));
    expect(rows).toHaveLength(7);
    expect(rows.filter((row) => row.scope === 'workspace')).toHaveLength(3);
    expect(rows.map((row) => row.slug).sort()).toEqual(
      [...ROLE_SEED].map((seed) => seed.slug).sort(),
    );
  });

  it('④ super-admin 在 role_permissions 中沒有任何列（隱含全集）', async () => {
    const [role] = await db.select().from(roles).where(eq(roles.slug, 'super-admin'));
    const rows = await db
      .select()
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, role!.id));
    expect(rows).toHaveLength(0);
  });

  it('⑤ admin 的權限集合 = ROLE_SEED 宣告的 26 筆（只有平台範圍）', async () => {
    const [role] = await db.select().from(roles).where(eq(roles.slug, 'admin'));
    const rows = await db
      .select({ key: permissions.key })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(rolePermissions.roleId, role!.id));
    const expected = ROLE_SEED.find((seed) => seed.slug === 'admin')!
      .permissions as readonly string[];
    expect(rows.map((row) => row.key).sort()).toEqual([...expected].sort());
    expect(expected).toHaveLength(26);
  });

  it('⑤-1 每個系統角色的權限鍵都與角色同範圍（docs/adr/0018-workspace-tenancy.md D3）', async () => {
    const rows = await db
      .select({ roleScope: roles.scope, keyScope: permissions.scope, key: permissions.key })
      .from(rolePermissions)
      .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.keyScope, row.key).toBe(row.roleScope);
  });

  it('⑤-2 建立預設工作區（一個工作區都沒有時）', async () => {
    const rows = await db.select().from(workspaces).where(isNull(workspaces.deletedAt));
    expect(rows.map((row) => row.slug)).toEqual(['default']);
  });

  it('⑥ 恰有一位使用者持有 super-admin', async () => {
    const rows = await db
      .select({ id: users.id })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(users, and(eq(users.id, userRoles.userId), isNull(users.deletedAt)))
      .where(eq(roles.slug, 'super-admin'));
    expect(rows).toHaveLength(1);
  });

  it('⑦ 連續執行兩次 seed，所有表的筆數不變（冪等）', async () => {
    const before = {
      permissions: await tableCount(db, 'permissions'),
      roles: await tableCount(db, 'roles'),
      rolePermissions: await tableCount(db, 'role_permissions'),
      users: await tableCount(db, 'users'),
      userRoles: await tableCount(db, 'user_roles'),
      workspaces: await tableCount(db, 'workspaces'),
    };
    await runSeed(db as never);
    const after = {
      permissions: await tableCount(db, 'permissions'),
      roles: await tableCount(db, 'roles'),
      rolePermissions: await tableCount(db, 'role_permissions'),
      users: await tableCount(db, 'users'),
      userRoles: await tableCount(db, 'user_roles'),
      workspaces: await tableCount(db, 'workspaces'),
    };
    expect(after).toEqual(before);
  });

  it('⑧ super-admin 的有效權限展開後：平台 27 筆（/auth/profile）＋ 工作區 10 筆（/workspaces/:id/me）', async () => {
    // 對應 PermissionService.getEffectivePermissionKeys / getEffectiveWorkspacePermissionKeys
    const platform = await db
      .select({ key: permissions.key })
      .from(permissions)
      .where(eq(permissions.scope, 'platform'));
    const workspace = await db
      .select({ key: permissions.key })
      .from(permissions)
      .where(eq(permissions.scope, 'workspace'));
    expect(platform).toHaveLength(27);
    expect(workspace).toHaveLength(10);
  });
});
