import { and, eq, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  auditLogs,
  authTokens,
  isRoleHolderTuple,
  isRolePermissionTuple,
  permissions,
  relationTuples,
  roles,
  SUPER_ADMIN_RELATION,
  users,
} from '@/db/schema';
import { sha256 } from '@/modules/credential/token-hash';

import type { TestDatabase } from '../../../../test/db';
import { createTestDatabase, truncateAll } from '../../../../test/db';
import { runSeed, seedCatalog } from '../index';
import { PERMISSION_SEED } from '../permissions';
import { ROLE_SEED } from '../roles';
import { seedSuperAdmin } from '../super-admin';

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

describe('db:seed（docs/architecture/iam/05-bootstrap.md §8 驗收清單）', () => {
  beforeAll(async () => {
    process.env.SUPER_ADMIN_EMAIL = 'seed-admin@example.com';
    process.env.SUPER_ADMIN_PASSWORD = 'Quiet-Harbor-Lantern-26';
    const created = createTestDatabase();
    db = created.db;
    close = async () => created.client.end();
    await truncateAll(db);
    await runSeed(db as never);
  });

  afterAll(async () => {
    await close();
  });

  it('① permissions 筆數 = PERMISSION_SEED.length（66）', async () => {
    expect(await tableCount(db, 'permissions')).toBe(PERMISSION_SEED.length);
    expect(PERMISSION_SEED.length).toBe(66);
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

  it('⑤ admin 的權限集合 = ROLE_SEED 宣告的 64 筆', async () => {
    const [role] = await db.select().from(roles).where(eq(roles.slug, 'admin'));
    const rows = await db
      .select({ key: relationTuples.relation })
      .from(relationTuples)
      .where(and(isRolePermissionTuple(), eq(relationTuples.subjectId, role!.id)));
    const expected = ROLE_SEED.find((seed) => seed.slug === 'admin')!
      .permissions as readonly string[];
    expect(rows.map((row) => row.key).sort()).toEqual([...expected].sort());
    expect(expected).toHaveLength(64);
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

  it('⑧ super-admin 的有效權限展開後為全部 66 筆', async () => {
    // 對應 GET /auth/profile 的展開行為（PermissionService.getEffectivePermissionKeys）
    const all = await db.select({ key: permissions.key }).from(permissions);
    expect(all).toHaveLength(66);
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

  it('⑩ SUPER_ADMIN_PASSWORD 不符合密碼政策時失敗，不靜默換成隨機密碼（docs/architecture/iam/05-bootstrap.md §5.1）', async () => {
    await truncateAll(db);
    const password = process.env.SUPER_ADMIN_PASSWORD;
    process.env.SUPER_ADMIN_PASSWORD = 'short-pw';
    try {
      await expect(runSeed(db as never)).rejects.toThrow('SUPER_ADMIN_PASSWORD');
      expect(await tableCount(db, 'users')).toBe(0);
    } finally {
      process.env.SUPER_ADMIN_PASSWORD = password;
    }
  });

  it('⑪ production 沒有提供密碼：建成 pending、不印密碼，印出帶租戶的一次性啟用連結；重跑換發新連結（§5.1）', async () => {
    await truncateAll(db);
    await seedCatalog(db as never);
    const env = {
      NODE_ENV: 'production',
      SUPER_ADMIN_EMAIL: 'first-admin@example.com',
      PLATFORM_APP_URL: 'https://accounts.example.com/',
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const first = await seedSuperAdmin(db as never, 'acme', env);
      const [user] = await db.select().from(users).where(eq(users.email, env.SUPER_ADMIN_EMAIL));
      expect(user?.status).toBe('pending');

      const link = new URL(first.activationLink ?? '');
      expect(link.origin + link.pathname).toBe('https://accounts.example.com/setup');
      expect(link.searchParams.get('tenant')).toBe('acme');
      const token = link.searchParams.get('token') ?? '';
      const [issued] = await db.select().from(authTokens).where(eq(authTokens.userId, user!.id));
      expect(issued).toMatchObject({
        purpose: 'activation',
        tokenHash: sha256(token),
        usedAt: null,
      });

      const printed = warn.mock.calls.flat().join('\n');
      expect(printed).toContain(first.activationLink);
      expect(printed).not.toContain('密碼：');

      // 重新部署：仍是唯一一位、還沒啟用 → 換發新的連結，舊的作廢
      const second = await seedSuperAdmin(db as never, 'acme', env);
      expect(second.activationLink).not.toBe(first.activationLink);
      const tokens = await db.select().from(authTokens).where(eq(authTokens.userId, user!.id));
      expect(tokens.filter((row) => row.usedAt === null)).toHaveLength(1);
      expect(await tableCount(db, 'users')).toBe(1);
    } finally {
      warn.mockRestore();
    }
  });
});
