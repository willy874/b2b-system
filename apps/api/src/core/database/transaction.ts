import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';

import type { Database } from './database.provider';
import type { fullSchema } from './database.provider';

export type Transaction = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof fullSchema,
  ExtractTablesWithRelations<typeof fullSchema>
>;

/** Repository 的寫入方法都接受可選的 `tx`，預設用注入的 db。 */
export type DbOrTx = Database | Transaction;

export async function withTransaction<T>(
  db: Database,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(fn);
}
