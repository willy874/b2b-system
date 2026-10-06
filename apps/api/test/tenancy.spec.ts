import { resolve } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { SecretBox, TENANT_SECRET_PURPOSE } from '@/core/crypto';
import { ObjectStorage } from '@/core/storage';
import { registerTenant } from '@/db/platform/register-tenant';
import * as platformSchema from '@/db/platform/schema';
import { users } from '@/db/schema';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';
import { databaseUrlOf } from './global-setup';
import { listenOnLoopback } from './http';
import { InMemoryObjectStorage } from './in-memory-object-storage';

let app: INestApplication;
let http: App;
/** 測試租戶（網域 127.0.0.1／localhost）。 */
let home: TestDatabase;
/** 第二個租戶（網域 other.test），自己的 database。 */
let other: TestDatabase;
const closers: Array<() => Promise<void>> = [];

const ROOT = { email: 'tenancy-root@example.com', password: 'Quiet-Harbor-Lantern-26' };
const ALICE = { email: 'alice@example.com', password: 'AlicePassword!2026' };

async function migrateTenantDatabase(url: string): Promise<void> {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(client);
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS citext`);
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await migrate(db, { migrationsFolder: resolve(__dirname, '../src/db/migrations') });
  await client.end();
}

function loginAt(host: string, credentials: { email: string; password: string }) {
  return request(http).post('/auth/login').set('Host', host).send(credentials);
}

async function tokenAt(host: string, credentials: { email: string; password: string }) {
  const response = await loginAt(host, credentials).expect(200);
  return (response.body as { data: { accessToken: string } }).data.accessToken;
}

function errorCodeOf(response: { body: unknown }): string | undefined {
  return (response.body as { error?: { code?: string } }).error?.code;
}

describe('租戶實體隔離（docs/architecture/05-tenancy.md §10.2 D1–D3、D14）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = ROOT.email;
    process.env.SUPER_ADMIN_PASSWORD = ROOT.password;
    process.env.AUTH_RATE_LIMIT = '1000';

    const platformUrl = inject('platformDatabaseUrl');
    const otherUrl = databaseUrlOf(platformUrl, 'b2b_tenant_other');
    const offUrl = databaseUrlOf(platformUrl, 'b2b_tenant_off');
    const behindUrl = databaseUrlOf(platformUrl, 'b2b_tenant_behind');
    const admin = postgres(platformUrl, { max: 1, onnotice: () => {} });
    await admin.unsafe('CREATE DATABASE b2b_tenant_other');
    await admin.unsafe('CREATE DATABASE b2b_tenant_off');
    await admin.unsafe('CREATE DATABASE b2b_tenant_behind');
    await admin.end();
    await migrateTenantDatabase(otherUrl);
    await migrateTenantDatabase(offUrl);
    // 程式比 DB 新：拿掉最後一筆套用紀錄，等同少跑了最新的 migration
    await migrateTenantDatabase(behindUrl);
    const behindClient = postgres(behindUrl, { max: 1, onnotice: () => {} });
    await behindClient`DELETE FROM drizzle.__drizzle_migrations
      WHERE created_at = (SELECT max(created_at) FROM drizzle.__drizzle_migrations)`;
    await behindClient.end();

    const platformClient = postgres(platformUrl, { max: 1, onnotice: () => {} });
    const platform = drizzle(platformClient, { schema: platformSchema });
    const box = SecretBox.fromConfig(inject('tenantSecretKey'), '', TENANT_SECRET_PURPOSE);
    await registerTenant(
      platform,
      {
        code: 'other',
        name: '另一個租戶',
        databaseUrl: otherUrl,
        storageBucket: 'b2b-other',
        domains: ['other.test'],
      },
      box,
    );
    const offId = await registerTenant(
      platform,
      {
        code: 'off',
        name: '停用的租戶',
        databaseUrl: offUrl,
        storageBucket: 'b2b-off',
        domains: ['off.test'],
      },
      box,
    );
    await registerTenant(
      platform,
      {
        code: 'behind',
        name: 'migration 落後的租戶',
        databaseUrl: behindUrl,
        storageBucket: 'b2b-behind',
        domains: ['behind.test'],
      },
      box,
    );
    await platform
      .update(platformSchema.tenants)
      .set({ status: 'disabled' })
      .where(eq(platformSchema.tenants.id, offId));
    await platformClient.end();

    const { runSeed } = await import('@/db/seeds/index');
    const { hashPassword } = await import('@/modules/credential/password');
    const homeDb = createTestDatabase();
    home = homeDb.db;
    closers.push(async () => homeDb.client.end());
    await truncateAll(home);
    await runSeed(home as never);

    const otherClient = postgres(otherUrl, { max: 2, onnotice: () => {} });
    other = drizzle(otherClient, { schema: (await import('@/core/database')).fullSchema });
    closers.push(async () => otherClient.end());
    await runSeed(other as never);
    await other.insert(users).values({
      email: ALICE.email,
      displayName: 'Alice',
      passwordHash: await hashPassword(ALICE.password),
      status: 'active',
    });

    const { AppModule } = await import('@/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ObjectStorage)
      .useValue(new InMemoryObjectStorage())
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.use(cookieParser());
    await app.init();
    http = await listenOnLoopback(app);
  });

  afterAll(async () => {
    await app.close();
    for (const close of closers) await close();
    delete process.env.AUTH_RATE_LIMIT;
  });

  it('同一組帳密只在它所屬的租戶有效：網域決定連哪個 database', async () => {
    await loginAt('other.test', ALICE).expect(200);
    const atHome = await loginAt('127.0.0.1', ALICE).expect(401);
    expect(errorCodeOf(atHome)).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('每個租戶有自己的 super-admin：同一個 email 在兩個租戶是兩個帳號', async () => {
    const [homeRoot] = await home.select().from(users).where(eq(users.email, ROOT.email));
    const [otherRoot] = await other.select().from(users).where(eq(users.email, ROOT.email));
    expect(homeRoot?.id).toBeDefined();
    expect(otherRoot?.id).toBeDefined();
    expect(homeRoot?.id).not.toBe(otherRoot?.id);
  });

  it('A 租戶簽發的 access token 拿到 B 租戶的網域用不了', async () => {
    const token = await tokenAt('other.test', ALICE);
    await request(http)
      .get('/auth/profile')
      .set('Host', 'other.test')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const crossed = await request(http)
      .get('/auth/profile')
      .set('Host', '127.0.0.1')
      .set('authorization', `Bearer ${token}`)
      .expect(401);
    expect(errorCodeOf(crossed)).toBe('AUTH_TOKEN_INVALID');
  });

  it('經 API 寫入的資料只在那個租戶的 database', async () => {
    const token = await tokenAt('other.test', ROOT);
    await request(http)
      .post('/users')
      .set('Host', 'other.test')
      .set('authorization', `Bearer ${token}`)
      .send({ email: 'bob@example.com', displayName: 'Bob', roleIds: [] })
      .expect(201);
    expect(await other.select().from(users).where(eq(users.email, 'bob@example.com'))).toHaveLength(
      1,
    );
    expect(await home.select().from(users).where(eq(users.email, 'bob@example.com'))).toHaveLength(
      0,
    );
  });

  it('不屬於任何租戶的網域：需要租戶的路由回 404 TENANT_NOT_FOUND，健康檢查照常', async () => {
    const response = await loginAt('nowhere.test', ROOT).expect(404);
    expect(errorCodeOf(response)).toBe('TENANT_NOT_FOUND');
    await request(http).get('/health').set('Host', 'nowhere.test').expect(200);
  });

  it('停用的租戶回 503 TENANT_UNAVAILABLE', async () => {
    const response = await loginAt('off.test', ROOT).expect(503);
    expect(errorCodeOf(response)).toBe('TENANT_UNAVAILABLE');
  });

  it('migration 落後的租戶回 503 TENANT_UNAVAILABLE，其他租戶照常（D14）', async () => {
    const response = await loginAt('behind.test', ROOT).expect(503);
    expect(errorCodeOf(response)).toBe('TENANT_UNAVAILABLE');
    await loginAt('other.test', ALICE).expect(200);
  });

  it('不是受信任的代理時不看 X-Forwarded-Host（不能靠標頭換租戶）', async () => {
    const response = await request(http)
      .post('/auth/login')
      .set('Host', '127.0.0.1')
      .set('X-Forwarded-Host', 'other.test')
      .send(ALICE)
      .expect(401);
    expect(errorCodeOf(response)).toBe('AUTH_INVALID_CREDENTIALS');
  });
});
