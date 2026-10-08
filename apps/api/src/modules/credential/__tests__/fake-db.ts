import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

/** 一次查詢建構（`db.select()…`）上依序呼叫的方法與參數。 */
export interface RecordedQuery {
  /** 起點：`select`、`update`、`insert`、`delete`。 */
  kind: string;
  calls: Array<{ method: string; args: unknown[] }>;
  /** 第一個名為 `method` 的呼叫的參數。 */
  arg(method: string, index?: number): unknown;
}

const dialect = new PgDialect();

/** 把 Drizzle 的條件轉成 SQL 字串與參數，斷言 where 的內容。 */
export function render(condition: unknown): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(condition as SQL);
}

/**
 * 假的 Drizzle 資料庫：每次 `select／update／insert／delete` 開一條新的鏈，記錄每個方法的參數；
 * `await` 時依呼叫順序回傳 `results` 裡的值（沒給的回傳 `[]`）。只給單元測試用——真正的 SQL 行為由整合測試驗證。
 */
export function fakeDb(results: unknown[] = []) {
  const queries: RecordedQuery[] = [];
  let awaited = 0;
  const start =
    (kind: string) =>
    (...startArgs: unknown[]) => {
      const query: RecordedQuery = {
        kind,
        calls: [{ method: kind, args: startArgs }],
        arg(method, index = 0) {
          return this.calls.find((call) => call.method === method)?.args[index];
        },
      };
      queries.push(query);
      const proxy: object = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === 'then') {
              const result = awaited < results.length ? results[awaited] : [];
              awaited += 1;
              return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
                Promise.resolve(result).then(resolve, reject);
            }
            return (...args: unknown[]) => {
              query.calls.push({ method: String(prop), args });
              return proxy;
            };
          },
        },
      );
      return proxy;
    };
  const db = {
    select: start('select'),
    update: start('update'),
    insert: start('insert'),
    delete: start('delete'),
  };
  return { db, queries };
}
