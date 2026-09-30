import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import type { TestProject } from 'vitest/node';

import { SecretBox, TENANT_SECRET_PURPOSE } from '../src/core/crypto';
import { registerTenant } from '../src/db/platform/register-tenant';
import * as platformSchema from '../src/db/platform/schema';

let container: StartedPostgreSqlContainer | undefined;

/** 整合測試的租戶：supertest 與 socket.io-client 連的是 127.0.0.1／localhost（不看 port）。 */
export const TEST_TENANT = { code: 'test', domains: ['127.0.0.1', 'localhost'] } as const;

async function prepare(url: string, migrationsFolder: string): Promise<void> {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(client);
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS citext`);
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await migrate(db, { migrationsFolder });
  await client.end();
}

/** 同一個 container 裡建第二個 database（租戶的 DB 與平台 DB 分開，docs/adr/0020-physical-tenant-isolation.md D1）。 */
export function databaseUrlOf(baseUrl: string, name: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

/**
 * 整合測試用的一次性 PostgreSQL。與 `docker-compose.yml` 使用同一個 image。
 * 平台 DB 是 container 預設的 database；測試租戶另建一個 database 並登記在平台 DB。
 */
export async function setup(project: TestProject): Promise<void> {
  container = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase('b2b_platform_test')
    .withUsername('test')
    .withPassword('test')
    .start();

  const platformUrl = container.getConnectionUri();
  const tenantUrl = databaseUrlOf(platformUrl, 'b2b_tenant_test');
  const admin = postgres(platformUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe('CREATE DATABASE b2b_tenant_test');
  await admin.end();

  await prepare(platformUrl, resolve(__dirname, '../src/db/platform/migrations'));
  await prepare(tenantUrl, resolve(__dirname, '../src/db/migrations'));

  const tenantSecretKey = randomBytes(32).toString('base64');
  const client = postgres(platformUrl, { max: 1, onnotice: () => {} });
  await registerTenant(
    drizzle(client, { schema: platformSchema }),
    {
      code: TEST_TENANT.code,
      name: '測試租戶',
      databaseUrl: tenantUrl,
      storageBucket: 'b2b-test',
      domains: [...TEST_TENANT.domains],
    },
    SecretBox.fromConfig(tenantSecretKey, '', TENANT_SECRET_PURPOSE),
  );
  await client.end();

  project.provide('databaseUrl', tenantUrl);
  project.provide('platformDatabaseUrl', platformUrl);
  project.provide('tenantSecretKey', tenantSecretKey);
}

export async function teardown(): Promise<void> {
  await container?.stop();
}

declare module 'vitest' {
  interface ProvidedContext {
    /** 測試租戶的 DB（業務資料）。 */
    databaseUrl: string;
    platformDatabaseUrl: string;
    tenantSecretKey: string;
  }
}
