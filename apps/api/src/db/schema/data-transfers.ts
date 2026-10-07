import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * 一次匯出或一次匯入（docs/architecture/backend/22-data-transfer.md §4.1）。含個資的業務資料，所以在租戶 DB；
 * 有期限的工作資料，不軟刪除、不進回收桶、不記版本歷史。匯入在 **送出套用時** 才建立，分析與預覽期間沒有這一列（D21）。
 */
export const dataTransfers = pgTable(
  'data_transfers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** `export` ｜ `import`。 */
    direction: text('direction').notNull(),
    /** 登記的資源類型（`DataTransferRegistry`）：`user`、`auditLog`。 */
    type: text('type').notNull(),
    /** 匯入：`create` ｜ `update`；匯出是 null。 */
    mode: text('mode'),
    /** `csv` ｜ `xlsx` ｜ `sql`。 */
    format: text('format').notNull(),
    /** 匯出：queued → running → completed｜failed｜cancelled；匯入：queued → applying → …；到期 → expired。 */
    status: text('status').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 建立當下的語系與時區：標頭、標籤、日期時間與檔名都以它們為準，之後改設定不影響進行中的傳輸。 */
    locale: text('locale').notNull(),
    timezone: text('timezone').notNull(),
    /** 匯出：`{ scope, columns }`；匯入：`{ skipInvalid, columns }`。 */
    params: jsonb('params').$type<Record<string, unknown>>().notNull(),
    /** 匯入：原始檔名（只用於顯示與結果報告的檔名；檔案本身不保存）。 */
    sourceName: text('source_name'),
    outputKey: text('output_key'),
    outputName: text('output_name'),
    outputSize: bigint('output_size', { mode: 'number' }),
    totalRows: integer('total_rows').notNull().default(0),
    processedRows: integer('processed_rows').notNull().default(0),
    succeededRows: integer('succeeded_rows').notNull().default(0),
    failedRows: integer('failed_rows').notNull().default(0),
    skippedRows: integer('skipped_rows').notNull().default(0),
    /** 整個傳輸無法進行時的錯誤碼（例：建立者的權限被拿掉）。 */
    errorCode: text('error_code'),
    errorDetails: jsonb('error_details').$type<Record<string, unknown>>(),
    /** 樂觀鎖：只保護傳輸本身的狀態轉移（使用者的取消與工作的更新不互相覆蓋）。 */
    version: integer('version').notNull().default(1),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('data_transfers_direction_check', sql`${t.direction} IN ('export', 'import')`),
    check('data_transfers_format_check', sql`${t.format} IN ('csv', 'xlsx', 'sql')`),
    check(
      'data_transfers_status_check',
      sql`${t.status} IN ('queued', 'running', 'applying', 'completed', 'failed', 'cancelled', 'expired')`,
    ),
    check(
      'data_transfers_mode_check',
      sql`(${t.direction} = 'import' AND ${t.mode} IN ('create', 'update')) OR (${t.direction} = 'export' AND ${t.mode} IS NULL)`,
    ),
    // 「我的匯入匯出」
    index('data_transfers_creator_idx').on(t.createdBy, t.createdAt.desc(), t.id),
    // 清理工作
    index('data_transfers_expires_idx').on(t.expiresAt),
    // 每人進行中的上限檢查
    index('data_transfers_active_idx')
      .on(t.createdBy)
      .where(sql`${t.status} IN ('queued', 'running', 'applying')`),
  ],
);

/**
 * 匯入的套用列（§4.1）：送出套用時一次寫入前端持有的 JSON，套用工作逐列處理並記錄結果。
 * 用途只有兩個：讓工作重試時恰好一次（該列的 outcome 與業務寫入在同一個交易，D9），以及結果報告。
 */
export const dataTransferRows = pgTable(
  'data_transfer_rows',
  {
    transferId: uuid('transfer_id')
      .notNull()
      .references(() => dataTransfers.id, { onDelete: 'cascade' }),
    /** 預覽中的列號（1 起）；手動新增的列接在最後。 */
    rowNo: integer('row_no').notNull(),
    /** 檔案中的實際列號（含標頭）；手動新增的是 null。 */
    sourceRow: integer('source_row'),
    /** `{ columnKey: 原始字串 }`：前端送來的 JSON 列。 */
    raw: jsonb('raw').$type<Record<string, string>>().notNull(),
    /** 修改模式：預覽時比對到的紀錄與 version（套用時仍以權限重新查詢，這兩個只是樂觀鎖的輸入）。 */
    targetId: uuid('target_id'),
    targetVersion: integer('target_version'),
    /** 修改模式：比對當下的關聯欄（例：`roleIds`），套用時原樣當成樂觀鎖的輸入。 */
    targetExpected: jsonb('target_expected').$type<Record<string, unknown>>(),
    /** `pending` ｜ `succeeded` ｜ `failed` ｜ `skipped` ｜ `cancelled`。 */
    outcome: text('outcome').notNull().default('pending'),
    /** `{ code, details }` 或 `{ code: 'VALIDATION_FAILED', issues }`。 */
    outcomeError: jsonb('outcome_error').$type<Record<string, unknown>>(),
    /** 修改模式：`{ columnKey: [原值, 新值] }`，在套用的交易內記下。 */
    changes: jsonb('changes').$type<Record<string, readonly [unknown, unknown]>>(),
    /** 套用後的紀錄 id（新增模式也有）。 */
    resultId: uuid('result_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.transferId, t.rowNo] }),
    check(
      'data_transfer_rows_outcome_check',
      sql`${t.outcome} IN ('pending', 'succeeded', 'failed', 'skipped', 'cancelled')`,
    ),
    index('data_transfer_rows_outcome_idx').on(t.transferId, t.outcome),
  ],
);

export type DataTransferRow = typeof dataTransfers.$inferSelect;
export type DataTransferInsert = typeof dataTransfers.$inferInsert;
export type DataTransferApplyRow = typeof dataTransferRows.$inferSelect;
export type DataTransferApplyRowInsert = typeof dataTransferRows.$inferInsert;
