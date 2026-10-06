import { sql } from 'drizzle-orm';
import { check, pgTable, smallint, text, timestamp } from 'drizzle-orm/pg-core';

/** 目前只有 `production` 會寫入；沒有列 = 不是正式環境。 */
export const PRODUCTION_ENVIRONMENT = 'production';

/**
 * 這個平台 DB 屬於哪一種環境（最多一列）。production 的 `db:migrate` 寫入 `production`，之後不會被改回來；
 * 會清空資料或寫入測試資料的腳本（`db:reset`、`db:seed:dev`、`db:seed:e2e`）讀到就拒絕執行——
 * 看的是目標 DB，不是執行腳本那個 shell 的 `NODE_ENV`（docs/architecture/backend/02-database.md §6.1）。
 */
export const platformEnvironment = pgTable(
  'platform_environment',
  {
    id: smallint('id').primaryKey().default(1),
    name: text('name').notNull(),
    markedAt: timestamp('marked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('platform_environment_single_row', sql`${t.id} = 1`)],
);
