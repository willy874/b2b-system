import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import type { Response } from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { users } from '@/db/schema';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;
let token: string;

const ROOT = { email: 'unique-root@example.com', password: 'Quiet-Harbor-Lantern-26' };

function dataOf<T>(response: Response): T {
  return (response.body as { data: T }).data;
}

async function createUser(email: string, username: string | null = null): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ email, username, displayName: email, status: 'active' })
    .returning();
  return user!.id;
}

describe('使用者的唯一值檢查（PATCH /users/:id）', () => {
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
    token = dataOf<{ accessToken: string }>(login).accessToken;
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    delete process.env.AUTH_RATE_LIMIT;
  });

  it('username 被佔用時，即使有較新的帳號部分符合（bob／bobby）也回 409 並帶 details', async () => {
    await createUser('owner-bob@example.com', 'bob');
    await createUser('owner-bobby@example.com', 'bobby');
    const target = await createUser('rename-target@example.com');

    const response = await request(http)
      .patch(`/users/${target}`)
      .set('authorization', `Bearer ${token}`)
      .send({ username: 'BOB', version: 1 })
      .expect(409);
    expect(response.body).toMatchObject({
      error: { code: 'USER_USERNAME_DUPLICATE', details: { field: 'username', value: 'BOB' } },
    });
  });

  it('只有部分符合的帳號時可以改名', async () => {
    await createUser('owner-alice2@example.com', 'alice2');
    const target = await createUser('rename-alice@example.com');

    await request(http)
      .patch(`/users/${target}`)
      .set('authorization', `Bearer ${token}`)
      .send({ username: 'alice', version: 1 })
      .expect(200);
  });
});
