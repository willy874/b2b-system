import {
  bigint,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { tenants } from './tenants';

/**
 * 每個租戶每天一列的用量（docs/architecture/05-tenancy.md §5.4）。日期是 UTC 的日曆日。
 *
 * - **快照**（使用者數、儲存量、最後登入）由每小時的彙總工作覆寫當天的值；歷史日的值是那天最後一次快照。
 *   還沒彙總過的日子是 `null`（只有計數的列）。
 * - **計數**（請求、背景工作）由每個程序在記憶體累計，每分鐘以 `+=` 加進當天的列，多程序天然可加總。
 * - 一個量一欄（不是 `metric`/`value` 的直式表）：列表要依量排序、詳情要一次取 30 天，寬表一個索引就夠（§14.2 D1）。
 * - 租戶被清除（`db:drop-tenant`）時一起刪掉（CASCADE）。
 */
export const tenantUsageDaily = pgTable(
  'tenant_usage_daily',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    /** 啟用中的人類使用者（`status = 'active'`，不含服務帳號與已刪除的）。 */
    usersActive: integer('users_active'),
    /** 未刪除的人類使用者。 */
    usersTotal: integer('users_total'),
    /** 未刪除的服務帳號。 */
    serviceAccounts: integer('service_accounts'),
    /** 已佔用的儲存量（含上傳中與回收桶裡的檔案，與配額判斷用的是同一個數字）。 */
    storageUsedBytes: bigint('storage_used_bytes', { mode: 'number' }),
    /** 快照當下的配額（`file.storageQuotaMb`）：配額改過之後，歷史的使用率仍以當時的配額計算。 */
    storageQuotaBytes: bigint('storage_quota_bytes', { mode: 'number' }),
    /** 人類使用者最近一次登入。 */
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    /** 最近一次快照的時間；`null` = 這一天還沒彙總過。 */
    snapshotAt: timestamp('snapshot_at', { withTimezone: true }),
    /** backstage 經內部 api 的請求數。 */
    requestsInternal: bigint('requests_internal', { mode: 'number' }).notNull().default(0),
    /** 對外 API（API token）的請求數。 */
    requestsExternal: bigint('requests_external', { mode: 'number' }).notNull().default(0),
    /** 開始執行的租戶背景工作數（重試也算一次）。 */
    jobsExecuted: bigint('jobs_executed', { mode: 'number' }).notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.date] }),
    // 保留期限的清理依日期刪除，跨租戶
    index('tenant_usage_daily_date_idx').on(t.date),
  ],
);

export type TenantUsageDailyRow = typeof tenantUsageDaily.$inferSelect;

/**
 * 每個租戶最近一次量到的已用量（docs/architecture/backend/25-image.md §12 D8）：平台的背景工作 `storage.totalRollup`
 * 每 5 分鐘逐一進入 active 的租戶讀計數並覆寫。合計（`SUM(used_bytes)`）就是儲存的止水線比對的數字。
 *
 * - 量不到的租戶（停用、這一輪失敗）保留上一次的值：它們的物件仍佔著空間；
 * - 已刪除但還沒清除的租戶也一樣，`db:drop-tenant` 清除時一起刪掉（CASCADE）。
 */
export const tenantStorageUsage = pgTable('tenant_storage_usage', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  usedBytes: bigint('used_bytes', { mode: 'number' }).notNull(),
  measuredAt: timestamp('measured_at', { withTimezone: true }).notNull(),
});
