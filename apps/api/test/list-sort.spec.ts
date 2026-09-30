import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { TransactionRollbackError, sql } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  permissions,
  relationTuples,
  roleHolderTuple,
  rolePermissionTuple,
  roles,
  users,
} from '@/db/schema';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;
let token: string;

const SUPER_ADMIN = { email: 'root@example.com', password: 'RootPassword!2026' };

async function listUsers(query: string): Promise<Array<{ email: string; displayName: string }>> {
  const response = await request(http)
    .get(`/users?keyword=sort-case&${query}`)
    .set('authorization', `Bearer ${token}`)
    .expect(200);
  return (response.body as { data: { items: Array<{ email: string; displayName: string }> } }).data
    .items;
}

interface RoleItem {
  id: string;
  name: string;
  permissionCount: number;
  userCount: number;
}

async function listRoles(query: string): Promise<RoleItem[]> {
  const response = await request(http)
    .get(`/roles?keyword=sort-case&${query}`)
    .set('authorization', `Bearer ${token}`)
    .expect(200);
  return (response.body as { data: { items: RoleItem[] } }).data.items;
}

/**
 * 角色與它的權限數、使用者數（啟用／已軟刪除）。
 * Alpha 的已刪除使用者若被算進去，userCount 會變成 3 而排到 Beta 前面。
 */
const ROLE_FIXTURES = [
  { name: 'Alpha sort-case', permissions: 3, activeUsers: 1, deletedUsers: 2 },
  { name: 'Beta sort-case', permissions: 1, activeUsers: 2, deletedUsers: 0 },
  { name: 'Gamma sort-case', permissions: 2, activeUsers: 0, deletedUsers: 0 },
  { name: 'Delta sort-case', permissions: 0, activeUsers: 0, deletedUsers: 1 },
] as const;

// email 不含 sort-case，免得混進上面使用者列表的排序案例
function holder(email: string, deletedAt: Date | null) {
  return {
    email,
    displayName: email,
    passwordHash: 'unused',
    status: 'active' as const,
    deletedAt,
  };
}

async function seedRoleFixtures(): Promise<void> {
  const permissionRows = await db.select({ key: permissions.key }).from(permissions).limit(3);
  await Promise.all(ROLE_FIXTURES.map((fixture) => seedRoleFixture(fixture, permissionRows)));
}

async function seedRoleFixture(
  fixture: (typeof ROLE_FIXTURES)[number],
  permissionRows: Array<{ key: string }>,
): Promise<void> {
  const slug = fixture.name.toLowerCase().replace(' ', '-');
  const [role] = await db.insert(roles).values({ slug, name: fixture.name }).returning();
  const roleId = role!.id;
  if (fixture.permissions) {
    await db
      .insert(relationTuples)
      .values(
        permissionRows
          .slice(0, fixture.permissions)
          .map((permission) => rolePermissionTuple(roleId, permission.key)),
      );
  }
  const holders = [
    ...Array.from({ length: fixture.activeUsers }, (_, index) =>
      holder(`holder-${roleId}-active-${index}@example.com`, null),
    ),
    ...Array.from({ length: fixture.deletedUsers }, (_, index) =>
      holder(`holder-${roleId}-deleted-${index}@example.com`, new Date()),
    ),
  ];
  if (!holders.length) return;
  const inserted = await db.insert(users).values(holders).returning({ id: users.id });
  await db.insert(relationTuples).values(inserted.map((user) => roleHolderTuple(roleId, user.id)));
}

describe('列表的多欄排序（docs/architecture/backend/03-api-conventions.md §2.1）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN.email;
    process.env.SUPER_ADMIN_PASSWORD = SUPER_ADMIN.password;

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);

    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);

    // 兩組同名的使用者：只靠第一個排序條件分不出先後
    await db.insert(users).values(
      [
        ['a1-sort-case@example.com', 'Alpha sort-case'],
        ['a2-sort-case@example.com', 'Alpha sort-case'],
        ['b1-sort-case@example.com', 'Beta sort-case'],
        ['b2-sort-case@example.com', 'Beta sort-case'],
      ].map(([email, displayName]) => ({
        email: email!,
        displayName: displayName!,
        passwordHash: 'unused',
        status: 'active' as const,
      })),
    );

    await seedRoleFixtures();

    const { AppModule } = await import('@/app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    http = await listenOnLoopback(app);

    const login = await request(http).post('/auth/login').send(SUPER_ADMIN).expect(200);
    token = (login.body as { data: { accessToken: string } }).data.accessToken;
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('依 sort 的出現順序決定優先順序', async () => {
    const items = await listUsers('sort=displayName&sort=-email');
    expect(items.map((item) => item.email)).toEqual([
      'a2-sort-case@example.com',
      'a1-sort-case@example.com',
      'b2-sort-case@example.com',
      'b1-sort-case@example.com',
    ]);
  });

  it('換個順序，結果跟著變', async () => {
    const items = await listUsers('sort=-displayName&sort=email');
    expect(items.map((item) => item.email)).toEqual([
      'b1-sort-case@example.com',
      'b2-sort-case@example.com',
      'a1-sort-case@example.com',
      'a2-sort-case@example.com',
    ]);
  });

  it.each([
    ['白名單以外的欄位', 'sort=passwordHash'],
    ['同一欄位出現兩次', 'sort=email&sort=-email'],
    ['舊格式', 'sort=email:asc'],
  ])('%s → 400', async (_, query) => {
    await request(http).get(`/users?${query}`).set('authorization', `Bearer ${token}`).expect(400);
  });

  it('角色可依權限數排序', async () => {
    const items = await listRoles('sort=-permissionCount');
    expect(items.map((item) => [item.name, item.permissionCount])).toEqual([
      ['Alpha sort-case', 3],
      ['Gamma sort-case', 2],
      ['Beta sort-case', 1],
      ['Delta sort-case', 0],
    ]);
  });

  it('角色可依使用者數排序，已軟刪除的使用者不計入', async () => {
    const items = await listRoles('sort=-userCount&sort=name');
    expect(items.map((item) => [item.name, item.userCount])).toEqual([
      ['Beta sort-case', 2],
      ['Alpha sort-case', 1],
      ['Delta sort-case', 0],
      ['Gamma sort-case', 0],
    ]);
  });

  it('角色詳情的 userCount 不含已軟刪除的使用者', async () => {
    const [alpha] = await listRoles('sort=name');
    const response = await request(http)
      .get(`/roles/${alpha!.id}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect((response.body as { data: RoleItem }).data.userCount).toBe(1);
  });

  describe('列表輸入邊界', () => {
    async function total(path: string): Promise<number> {
      const response = await request(http)
        .get(path)
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      return (response.body as { data: { pagination: { total: number } } }).data.pagination.total;
    }

    it.each([
      ['使用者：_ 不是萬用字元', '/users?keyword=_'],
      ['使用者：% 不是萬用字元', '/users?keyword=%25'],
      ['角色：_ 不是萬用字元', '/roles?keyword=_'],
      ['角色：\\ 不會讓 pattern 失效', '/roles?keyword=%5C'],
    ])('%s', async (_name, path) => {
      // 測試資料的 email、名稱、slug 都沒有這些字元
      expect(await total(path)).toBe(0);
    });

    it('關鍵字裡的底線照字面比對', async () => {
      await db.insert(users).values(holder('under_score@example.com', null));
      expect(await total('/users?keyword=under_s')).toBe(1);
      expect(await total('/users?keyword=under_')).toBe(1);
    });

    it('使用者關鍵字的三個運算式都用得上 trigram 索引', async () => {
      // 與 user.repository 的 buildFilters 相同的運算式。測試的資料量下 planner 會選循序掃描，
      // 所以在交易裡灌一批使用者、更新統計、關掉循序掃描，看完計畫就 rollback
      let text = '';
      await db
        .transaction(async (tx) => {
          await tx.execute(
            sql`INSERT INTO users (email, username, display_name, status) SELECT 'bulk' || g || '@example.com', 'bulk' || g, 'Bulk ' || g, 'active' FROM generate_series(1, 5000) AS g`,
          );
          // 新插入的列在 GIN 的 pending list 裡，planner 會把掃它的成本估得很高；先併進索引本體
          await tx.execute(
            sql`SELECT gin_clean_pending_list(name::regclass) FROM unnest(ARRAY['users_email_trgm_idx', 'users_username_trgm_idx', 'users_display_name_trgm_idx']) AS name`,
          );
          await tx.execute(sql`ANALYZE users`);
          // 只排除循序掃描：還是要讓 planner 在各索引之間自己挑
          await tx.execute(sql`SET LOCAL enable_seqscan = off`);
          const plan = await tx.execute<{ 'QUERY PLAN': string }>(
            sql`EXPLAIN SELECT id FROM users WHERE deleted_at IS NULL AND (email::text ILIKE '%keyword%' OR username::text ILIKE '%keyword%' OR display_name ILIKE '%keyword%')`,
          );
          text = plan.map((row) => row['QUERY PLAN']).join('\n');
          tx.rollback();
        })
        .catch((error: unknown) => {
          if (!(error instanceof TransactionRollbackError)) throw error;
        });
      expect(text).toContain('users_email_trgm_idx');
      expect(text).toContain('users_username_trgm_idx');
      expect(text).toContain('users_display_name_trgm_idx');
    });

    it('offset 上限 10000：剛好上限可以，超過回 400', async () => {
      expect(await total('/users?offset=10000')).toBeGreaterThan(0);
      for (const offset of ['10001', '99999999999', '1e19']) {
        // oxlint-disable-next-line no-await-in-loop -- 依序送出，失敗時看得出是哪一個
        const response = await request(http)
          .get(`/users?offset=${offset}`)
          .set('authorization', `Bearer ${token}`)
          .expect(400);
        expect(response.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
      }
    });
  });

  it('只剩已軟刪除的使用者持有時，刪除角色不回 ROLE_IN_USE', async () => {
    const delta = (await listRoles('sort=name')).find((item) => item.name === 'Delta sort-case');
    await request(http)
      .delete(`/roles/${delta!.id}`)
      .set('authorization', `Bearer ${token}`)
      .expect(204);
  });
});
