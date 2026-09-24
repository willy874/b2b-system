import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { users } from '@/db/schema';

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
});
