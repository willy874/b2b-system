import { resolve } from 'node:path';

import { config as loadEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as relations from './relations';
import * as schema from './schema';

/** CLI 腳本（migrate / seed）用的連線：不經過 Nest DI。 */
export function loadScriptEnv(): void {
  loadEnv({ path: resolve(process.cwd(), '.env'), quiet: true });
  loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });
}

export function createScriptClient(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL 未設定');
  const client = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(client, { schema: { ...schema, ...relations } });
  return { client, db };
}

export type ScriptDatabase = ReturnType<typeof createScriptClient>['db'];
