import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as platformSchema from '@/db/platform/schema';
import * as relations from '@/db/relations';
import * as schema from '@/db/schema';

/** 租戶 DB 的 schema（每個租戶的 database 都是這一套，docs/adr/0020-physical-tenant-isolation.md D1）。 */
export const fullSchema = { ...schema, ...relations };
/** 平台 DB 的 schema：租戶登記、IdP 的協定狀態。 */
export const fullPlatformSchema = { ...platformSchema };

export type Database = ReturnType<typeof createDatabase>['db'];
export type PlatformDatabase = ReturnType<typeof createPlatformDatabase>['db'];

export interface DatabaseOptions {
  url: string;
  max: number;
  logQueries: boolean;
  /** 閒置多久（秒）關閉連線；租戶的連線池設短一點，沒人用的租戶不佔連線。 */
  idleTimeout?: number;
}

function createClient({ url, max, idleTimeout = 30 }: DatabaseOptions) {
  return postgres(url, {
    max,
    idle_timeout: idleTimeout,
    connect_timeout: 10,
    onnotice: () => {}, // 靜音 NOTICE
  });
}

export function createDatabase(options: DatabaseOptions) {
  const client = createClient(options);
  const db = drizzle(client, { schema: fullSchema, logger: options.logQueries });
  return { client, db };
}

export function createPlatformDatabase(options: DatabaseOptions) {
  const client = createClient(options);
  const db = drizzle(client, { schema: fullPlatformSchema, logger: options.logQueries });
  return { client, db };
}

/**
 * DI token：**目前租戶** 的 database（依請求的網域、背景工作的 `tenantId` 決定，
 * docs/adr/0020-physical-tenant-isolation.md D3）。業務的 repository 都注入這個；
 * 沒有租戶脈絡時存取它會拋 `TENANT_NOT_FOUND`，不會退回任何預設的 database。
 */
export const TENANT_DB = Symbol('TENANT_DB');
/** DI token：平台 DB（租戶登記、`oidc_payloads`）。 */
export const PLATFORM_DB = Symbol('PLATFORM_DB');
