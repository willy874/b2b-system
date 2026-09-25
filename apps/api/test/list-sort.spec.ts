import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { permissions, rolePermissions, roles, userRoles, users } from '@/db/schema';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';

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
  const permissionRows = await db.select({ id: permissions.id }).from(permissions).limit(3);
  await Promise.all(ROLE_FIXTURES.map((fixture) => seedRoleFixture(fixture, permissionRows)));
}

async function seedRoleFixture(
  fixture: (typeof ROLE_FIXTURES)[number],
  permissionRows: Array<{ id: string }>,
): Promise<void> {
  const slug = fixture.name.toLowerCase().replace(' ', '-');
  const [role] = await db.insert(roles).values({ slug, name: fixture.name }).returning();
  const roleId = role!.id;
  if (fixture.permissions) {
    await db
      .insert(rolePermissions)
      .values(
        permissionRows
          .slice(0, fixture.permissions)
          .map((permission) => ({ roleId, permissionId: permission.id })),
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
  await db.insert(userRoles).values(inserted.map((user) => ({ userId: user.id, roleId })));
}

describe('列表的多欄排序（docs/architecture/backend/03-api-conventions.md §2.1）', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = inject('databaseUrl');
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
    http = app.getHttpServer() as App;

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

  it('只剩已軟刪除的使用者持有時，刪除角色不回 ROLE_IN_USE', async () => {
    const delta = (await listRoles('sort=name')).find((item) => item.name === 'Delta sort-case');
    await request(http)
      .delete(`/roles/${delta!.id}`)
      .set('authorization', `Bearer ${token}`)
      .expect(204);
  });
});
