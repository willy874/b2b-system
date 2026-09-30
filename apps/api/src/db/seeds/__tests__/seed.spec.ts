import { and, eq, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { permissions, rolePermissions, roles, userRoles, users } from '@/db/schema';

import type { TestDatabase } from '../../../../test/db';
import { createTestDatabase, truncateAll } from '../../../../test/db';
import { runSeed } from '../index';
import { PERMISSION_SEED } from '../permissions';
import { ROLE_SEED } from '../roles';

let db: TestDatabase;
let close: () => Promise<void>;

async function tableCount(
  database: TestDatabase,
  table: 'permissions' | 'roles' | 'role_permissions' | 'users' | 'user_roles',
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

  it('① permissions 筆數 = PERMISSION_SEED.length（29）', async () => {
    expect(await tableCount(db, 'permissions')).toBe(PERMISSION_SEED.length);
    expect(PERMISSION_SEED.length).toBe(29);
  });

  it("② 每筆 permissions.key = resource || ':' || action", async () => {
    const rows = await db.select().from(permissions);
    for (const row of rows) expect(row.key).toBe(`${row.resource}:${row.action}`);
  });

  it('③ roles 中恰有 4 筆 is_system = true', async () => {
    const rows = await db.select().from(roles).where(eq(roles.isSystem, true));
    expect(rows).toHaveLength(4);
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

  it('⑤ admin 的權限集合 = ROLE_SEED 宣告的 28 筆', async () => {
    const [role] = await db.select().from(roles).where(eq(roles.slug, 'admin'));
    const rows = await db
      .select({ key: permissions.key })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(rolePermissions.roleId, role!.id));
    const expected = ROLE_SEED.find((seed) => seed.slug === 'admin')!
      .permissions as readonly string[];
    expect(rows.map((row) => row.key).sort()).toEqual([...expected].sort());
    expect(expected).toHaveLength(28);
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
    };
    await runSeed(db as never);
    const after = {
      permissions: await tableCount(db, 'permissions'),
      roles: await tableCount(db, 'roles'),
      rolePermissions: await tableCount(db, 'role_permissions'),
      users: await tableCount(db, 'users'),
      userRoles: await tableCount(db, 'user_roles'),
    };
    expect(after).toEqual(before);
  });

  it('⑧ super-admin 的有效權限展開後為全部 29 筆', async () => {
    // 對應 GET /auth/profile 的展開行為（PermissionService.getEffectivePermissionKeys）
    const all = await db.select({ key: permissions.key }).from(permissions);
    expect(all).toHaveLength(29);
  });
});
