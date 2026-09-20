import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as relations from '@/db/relations';
import * as schema from '@/db/schema';

export const fullSchema = { ...schema, ...relations };

export type Database = ReturnType<typeof createDatabase>['db'];

export interface DatabaseOptions {
  url: string;
  max: number;
  logQueries: boolean;
}

export function createDatabase({ url, max, logQueries }: DatabaseOptions) {
  const client = postgres(url, {
    max,
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: () => {}, // 靜音 NOTICE
  });
  const db = drizzle(client, { schema: fullSchema, logger: logQueries });
  return { client, db };
}

/** DI token。所有 repository 都注入這個。 */
export const DRIZZLE = Symbol('DRIZZLE');
export const PG_CLIENT = Symbol('PG_CLIENT');
