import { resolve } from 'node:path';

import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { createScriptClient } from './connect';

/** 租戶與平台的 migration 資料夾（build 之後由 nest-cli 的 assets 複製到 `dist/src/db/`）。 */
export const TENANT_MIGRATIONS_FOLDER = resolve(__dirname, 'migrations');
export const PLATFORM_MIGRATIONS_FOLDER = resolve(__dirname, 'platform/migrations');

/** 必要擴充：citext（大小寫不敏感 email、網域）、pgcrypto（gen_random_uuid）。兩者都是 trusted，database 的擁有者就能建立。 */
export async function ensureExtensions(db: {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
}): Promise<void> {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS citext`);
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
}

/** 在一個租戶的 DB 套用租戶 migration（`db:migrate` 與佈建共用）。 */
export async function migrateTenantDatabase(url: string): Promise<void> {
  const { client, db } = createScriptClient(url);
  try {
    await ensureExtensions(db);
    await migrate(db, { migrationsFolder: TENANT_MIGRATIONS_FOLDER });
  } finally {
    await client.end();
  }
}

/** 租戶的 DB 角色與 database 名稱：小寫英數與底線，Postgres 的識別字不必再跳脫。 */
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

function identifier(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`不合法的識別字：${name}`);
  return `"${name}"`;
}

/**
 * 建立（或對齊）租戶自己的 DB 角色與 database（docs/architecture/05-tenancy.md §10.2 D4、D12），冪等：
 * 重試佈建時已存在的角色會把密碼改回連線字串上的那一組，已存在的 database 沿用。
 * database 的擁有者是租戶的角色，別的角色（`PUBLIC`）不能連線——租戶的連線字串外洩也碰不到別的租戶。
 *
 * `adminUrl` 要有 `CREATEDB` 與 `CREATEROLE`（`TENANT_PROVISIONING_DATABASE_URL`）。
 */
export async function ensureTenantDatabase(adminUrl: string, tenantUrl: string): Promise<void> {
  const target = new URL(tenantUrl);
  const role = decodeURIComponent(target.username);
  const password = decodeURIComponent(target.password);
  const database = decodeURIComponent(target.pathname.slice(1));
  // 密碼是佈建時產生的十六進位字串；仍然檢查，才能放心寫進 DDL（DDL 不能用參數）
  if (!/^[a-f0-9]{16,}$/.test(password)) throw new Error('租戶 DB 角色的密碼格式不對');

  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    const [roleExists] = await admin`SELECT 1 FROM pg_roles WHERE rolname = ${role}`;
    await admin.unsafe(
      `${roleExists ? 'ALTER' : 'CREATE'} ROLE ${identifier(role)} LOGIN PASSWORD '${password}'`,
    );
    const [databaseExists] = await admin`SELECT 1 FROM pg_database WHERE datname = ${database}`;
    if (!databaseExists) {
      await admin.unsafe(`CREATE DATABASE ${identifier(database)} OWNER ${identifier(role)}`);
    }
    await admin.unsafe(`REVOKE ALL ON DATABASE ${identifier(database)} FROM PUBLIC`);
  } finally {
    await admin.end();
  }
}
