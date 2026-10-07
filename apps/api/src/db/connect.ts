import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as platformSchema from './platform/schema';
import * as relations from './relations';
import * as schema from './schema';

/**
 * 不經過 Nest DI 的單一連線：CLI 腳本（migrate／seed／reset）與租戶佈建（連到剛建好的租戶 DB）共用。
 * 這裡不讀 `.env`、不印東西，執行期可以 import（docs/coding-standards/07-layer-dependencies.md §3.2 註 1）；
 * 讀 `.env` 的部分在 CLI 專用的 `./client`。
 */
export function createScriptClient(url: string) {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(client, { schema: { ...schema, ...relations } });
  return { client, db };
}

/** 租戶 DB（業務資料的 schema）。 */
export type ScriptDatabase = ReturnType<typeof createScriptClient>['db'];

export function createPlatformScriptClient(url = process.env.PLATFORM_DATABASE_URL) {
  if (!url) throw new Error('PLATFORM_DATABASE_URL 未設定');
  const client = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(client, { schema: platformSchema });
  return { client, db };
}

export type PlatformScriptDatabase = ReturnType<typeof createPlatformScriptClient>['db'];
