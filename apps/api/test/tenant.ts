import { resolve } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { inject } from 'vitest';

import { SecretBox, TENANT_SECRET_PURPOSE } from '@/core/crypto';
import { fullSchema } from '@/core/database';
import { runInTenantContext, Tenancy, TenantDirectory } from '@/core/tenant';
import type { TenantContext } from '@/core/tenant';
import { registerTenant } from '@/db/platform/register-tenant';

import type { TestDatabase } from './db';
import { createPlatformTestDatabase } from './db';
import { databaseUrlOf } from './global-setup';

/**
 * 測試租戶的脈絡：直接呼叫 service（不經 HTTP）的測試要在租戶裡執行，
 * 否則存取 `TENANT_DB` 會拋 `TENANT_NOT_FOUND`（docs/adr/0020-physical-tenant-isolation.md D3）。
 */
export async function testTenantContext(app: INestApplication): Promise<TenantContext> {
  const record = await app.get(TenantDirectory).resolveHost('127.0.0.1');
  if (!record) throw new Error('測試租戶沒有登記（test/global-setup.ts）');
  return app.get(Tenancy).contextOf(record);
}

export async function inTestTenant<T>(app: INestApplication, fn: () => Promise<T>): Promise<T> {
  return runInTenantContext(await testTenantContext(app), fn);
}

/**
 * 在同一個 container 裡多建一個租戶（自己的 database，已跑 migration 並登記網域）。
 * 同一個 code 重複呼叫時沿用既有的 database 與登記（測試檔之間共用 container）。
 */
export async function createExtraTenant(
  code: string,
  domains: string[],
): Promise<{ id: string; db: TestDatabase; close: () => Promise<void> }> {
  const platformUrl = inject('platformDatabaseUrl');
  const name = `b2b_tenant_${code.replaceAll('-', '_')}`;
  const url = databaseUrlOf(platformUrl, name);
  const admin = postgres(platformUrl, { max: 1, onnotice: () => {} });
  const [exists] = await admin`SELECT 1 FROM pg_database WHERE datname = ${name}`;
  if (!exists) await admin.unsafe(`CREATE DATABASE ${name}`);
  await admin.end();

  const migrator = postgres(url, { max: 1, onnotice: () => {} });
  const migrationDb = drizzle(migrator);
  await migrationDb.execute(sql`CREATE EXTENSION IF NOT EXISTS citext`);
  await migrationDb.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await migrate(migrationDb, { migrationsFolder: resolve(__dirname, '../src/db/migrations') });
  await migrator.end();

  const platform = createPlatformTestDatabase();
  const id = await registerTenant(
    platform.db,
    { code, name: `租戶 ${code}`, databaseUrl: url, domains },
    SecretBox.fromConfig(inject('tenantSecretKey'), '', TENANT_SECRET_PURPOSE),
  );
  await platform.client.end();

  const client = postgres(url, { max: 2, onnotice: () => {} });
  const db = drizzle(client, { schema: fullSchema });
  return { id, db, close: async () => client.end() };
}
