import { and, eq, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  auditLogs,
  isRoleHolderTuple,
  isRolePermissionTuple,
  permissions,
  relationTuples,
  roles,
  SUPER_ADMIN_RELATION,
  users,
} from '@/db/schema';

import type { TestDatabase } from '../../../../test/db';
import { createTestDatabase, truncateAll } from '../../../../test/db';
import { runSeed } from '../index';
import { PERMISSION_SEED } from '../permissions';
import { ROLE_SEED } from '../roles';

let db: TestDatabase;
let close: () => Promise<void>;

async function tableCount(
  database: TestDatabase,
  table: 'permissions' | 'roles' | 'relation_tuples' | 'users',
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

  it('④ super-admin 沒有任何權限鍵的邊，只有租戶節點上的 superAdmin（隱含全集）', async () => {
    const [role] = await db.select().from(roles).where(eq(roles.slug, 'super-admin'));
    const rows = await db
      .select({ relation: relationTuples.relation })
      .from(relationTuples)
      .where(
        and(
          eq(relationTuples.subjectType, 'role'),
          eq(relationTuples.subjectId, role!.id),
          eq(relationTuples.subjectRelation, 'holder'),
        ),
      );
    expect(rows).toEqual([{ relation: SUPER_ADMIN_RELATION }]);
  });

  it('⑤ admin 的權限集合 = ROLE_SEED 宣告的 28 筆', async () => {
    const [role] = await db.select().from(roles).where(eq(roles.slug, 'admin'));
    const rows = await db
      .select({ key: relationTuples.relation })
      .from(relationTuples)
      .where(and(isRolePermissionTuple(), eq(relationTuples.subjectId, role!.id)));
    const expected = ROLE_SEED.find((seed) => seed.slug === 'admin')!
      .permissions as readonly string[];
    expect(rows.map((row) => row.key).sort()).toEqual([...expected].sort());
    expect(expected).toHaveLength(28);
  });

  it('⑥ 恰有一位使用者持有 super-admin', async () => {
    const rows = await db
      .select({ id: users.id })
      .from(relationTuples)
      .innerJoin(roles, eq(sql`${roles.id}::text`, relationTuples.objectId))
      .innerJoin(
        users,
        and(eq(sql`${users.id}::text`, relationTuples.subjectId), isNull(users.deletedAt)),
      )
      .where(and(isRoleHolderTuple(), eq(roles.slug, 'super-admin')));
    expect(rows).toHaveLength(1);
  });

  it('⑦ 連續執行兩次 seed，所有表的筆數不變（冪等）', async () => {
    const before = {
      permissions: await tableCount(db, 'permissions'),
      roles: await tableCount(db, 'roles'),
      users: await tableCount(db, 'users'),
      relationTuples: await tableCount(db, 'relation_tuples'),
    };
    await runSeed(db as never);
    const after = {
      permissions: await tableCount(db, 'permissions'),
      roles: await tableCount(db, 'roles'),
      users: await tableCount(db, 'users'),
      relationTuples: await tableCount(db, 'relation_tuples'),
    };
    expect(after).toEqual(before);
  });

  it('⑧ super-admin 的有效權限展開後為全部 29 筆', async () => {
    // 對應 GET /auth/profile 的展開行為（PermissionService.getEffectivePermissionKeys）
    const all = await db.select({ key: permissions.key }).from(permissions);
    expect(all).toHaveLength(29);
  });

  it('⑨ 權限依賴樹多出鍵的角色寫一筆 role.permissionsImplied；重跑不重複（§9.3）', async () => {
    const implied = async () =>
      db.select().from(auditLogs).where(eq(auditLogs.action, 'role.permissionsImplied'));
    const [auditor] = await db.select().from(roles).where(eq(roles.slug, 'auditor'));
    const rows = await implied();
    // 預設角色只有 auditor 多出鍵：file:read ⇒ file:access
    expect(rows.map((row) => [row.resourceId, row.metadata])).toEqual([
      [auditor!.id, expect.objectContaining({ implied: ['file:access'] })],
    ]);
    await runSeed(db as never);
    expect(await implied()).toHaveLength(1);
  });
});
