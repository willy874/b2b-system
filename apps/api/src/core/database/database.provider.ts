import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import type { Env } from '@/core/config';
import * as platformSchema from '@/db/platform/schema';
import * as relations from '@/db/relations';
import * as schema from '@/db/schema';

/** 租戶 DB 的 schema（每個租戶的 database 都是這一套，docs/adr/0020-physical-tenant-isolation.md D1）。 */
export const fullSchema = { ...schema, ...relations };
/** 平台 DB 的 schema：租戶登記、IdP 的協定狀態。 */
export const fullPlatformSchema = { ...platformSchema };

export type Database = ReturnType<typeof createDatabase>['db'];
export type PlatformDatabase = ReturnType<typeof createPlatformDatabase>['db'];

/**
 * 每條連線的逾時（docs/architecture/backend/02-database.md §6.2）：一條失控的查詢或忘了結束的交易
 * 不能無限期佔住連線池（池很小，佔住一條就是其他請求排隊）。
 */
export interface ConnectionLimits {
  /** 建立連線的逾時（秒）。 */
  connectTimeout: number;
  /** 單一語句的上限（毫秒）；0 = 不限制。 */
  statementTimeoutMs: number;
  /** 交易開著卻閒置的上限（毫秒）；超過由 postgres 結束該連線。0 = 不限制。 */
  idleInTransactionTimeoutMs: number;
}

export const DEFAULT_CONNECTION_LIMITS: ConnectionLimits = {
  connectTimeout: 10,
  statementTimeoutMs: 15_000,
  idleInTransactionTimeoutMs: 30_000,
};

export type ConnectionLimitsEnv = Pick<
  Env,
  'DB_CONNECT_TIMEOUT' | 'DB_STATEMENT_TIMEOUT_MS' | 'DB_IDLE_IN_TRANSACTION_TIMEOUT_MS'
>;

export function connectionLimitsOf(env: ConnectionLimitsEnv): ConnectionLimits {
  return {
    connectTimeout: env.DB_CONNECT_TIMEOUT,
    statementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
    idleInTransactionTimeoutMs: env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  };
}

export interface DatabaseOptions {
  url: string;
  max: number;
  logQueries: boolean;
  /** 閒置多久（秒）關閉連線；租戶的連線池設短一點，沒人用的租戶不佔連線。 */
  idleTimeout?: number;
  limits?: ConnectionLimits;
}

/** postgres.js 的選項；逾時以連線參數（startup parameters）送出，每條連線建立時就生效。 */
export function postgresOptionsOf({
  max,
  idleTimeout = 30,
  limits = DEFAULT_CONNECTION_LIMITS,
}: Omit<DatabaseOptions, 'url' | 'logQueries'>): postgres.Options<Record<string, never>> {
  const connection: Record<string, number> = {};
  if (limits.statementTimeoutMs > 0) connection.statement_timeout = limits.statementTimeoutMs;
  if (limits.idleInTransactionTimeoutMs > 0) {
    connection.idle_in_transaction_session_timeout = limits.idleInTransactionTimeoutMs;
  }
  return {
    max,
    idle_timeout: idleTimeout,
    connect_timeout: limits.connectTimeout,
    connection,
    onnotice: () => {}, // 靜音 NOTICE
  };
}

function createClient({ url, ...options }: DatabaseOptions) {
  return postgres(url, postgresOptionsOf(options));
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
