import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';

import type {
  Database,
  fullPlatformSchema,
  fullSchema,
  PlatformDatabase,
} from './database.provider';

export type Transaction = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof fullSchema,
  ExtractTablesWithRelations<typeof fullSchema>
>;

export type PlatformTransaction = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof fullPlatformSchema,
  ExtractTablesWithRelations<typeof fullPlatformSchema>
>;

/** Repository 的寫入方法都接受可選的 `tx`，預設用注入的 db。 */
export type DbOrTx = Database | Transaction;
export type PlatformDbOrTx = PlatformDatabase | PlatformTransaction;

type AfterCommitHook = () => Promise<void> | void;

/** 交易 → 提交後要做的事；只有 `withTransaction` 開的交易有登記表。 */
const afterCommitHooks = new WeakMap<object, AfterCommitHook[]>();

/**
 * 交易提交後執行 `hook`（例：把交易內寫進 outbox 的工作搬進佇列）。回滾時不執行。
 * 交易已經提交，hook 應自行處理失敗（例：記錄後交給定期的補救機制）；拋出的錯誤仍會傳回呼叫端。
 */
export function afterCommit(tx: Transaction | PlatformTransaction, hook: AfterCommitHook): void {
  const hooks = afterCommitHooks.get(tx);
  if (!hooks)
    throw new Error('afterCommit 只能用在 withTransaction 開的交易（不含巢狀的 savepoint）');
  hooks.push(hook);
}

export async function withTransaction<T>(
  db: Database,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T>;
export async function withTransaction<T>(
  db: PlatformDatabase,
  fn: (tx: PlatformTransaction) => Promise<T>,
): Promise<T>;
export async function withTransaction<T>(
  db: Database | PlatformDatabase,
  fn: (tx: never) => Promise<T>,
): Promise<T> {
  const hooks: AfterCommitHook[] = [];
  const result = await (db as Database).transaction(async (tx) => {
    // 單元測試會傳假的交易（非物件）；那時沒有 afterCommit 可以用
    if (typeof tx === 'object' && tx !== null) afterCommitHooks.set(tx, hooks);
    return fn(tx as never);
  });
  for (const hook of hooks) {
    // oxlint-disable-next-line no-await-in-loop -- 依登記順序執行
    await hook();
  }
  return result;
}
