import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * `pending`：已登記、等待瀏覽器直傳到物件儲存；`ready`：已確認物件存在且大小相符。
 * 見 docs/architecture/backend/09-file.md §4。
 */
export const FILE_STATUSES = ['pending', 'ready'] as const;
export const fileStatus = pgEnum('file_status', FILE_STATUSES);
export type FileStatus = (typeof FILE_STATUSES)[number];

/**
 * 檔案的轉介層：對外一律用 `id`，物件儲存的 key（`storage_key`）只在後端使用。
 * 換儲存後端、搬 key 的命名規則時，前端與其他資料表都不受影響。
 */
export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 顯示用檔名（含副檔名），可改名；與物件儲存的 key 無關。 */
    name: text('name').notNull(),
    contentType: text('content_type').notNull(),
    /** pending 時是登記的大小；ready 時是物件儲存實際的大小（兩者必須相同才會 ready）。 */
    size: bigint('size', { mode: 'number' }).notNull(),
    storageKey: text('storage_key').notNull(),
    /** 物件儲存回報的 ETag（不含引號）；ready 之後才有值。 */
    etag: text('etag'),
    status: fileStatus('status').notNull().default('pending'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
    /**
     * 分塊上傳（S3 multipart upload）的 uploadId；單次 PUT 上傳、或已完成時為 null。
     * 見 docs/architecture/backend/09-file.md §5.2。
     */
    uploadId: text('upload_id'),
    /** 瀏覽器在上傳時一併產生並上傳的縮圖（`thumbnails/<id>`）已確認存在。 */
    hasThumbnail: boolean('has_thumbnail').notNull().default(false),
    /**
     * 樂觀鎖：每次改名遞增。前端帶上看到的版本，版本不同代表別人已經改過（`FILE_VERSION_CONFLICT`）。
     * 不用 `updated_at` 比對：它是微秒精度，經過 JSON（毫秒）來回之後就對不上。
     */
    version: integer('version').notNull().default(1),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('files_storage_key_key').on(t.storageKey),
    check('files_size_non_negative', sql`${t.size} >= 0`),
    // ready 一定經過物件儲存確認：沒有 ETag 或上傳時間的 ready 是不可能的狀態
    check(
      'files_ready_confirmed',
      sql`${t.status} = 'pending' OR (${t.etag} IS NOT NULL AND ${t.uploadedAt} IS NOT NULL)`,
    ),
    index('files_status_created_at_idx')
      .on(t.status, t.createdAt)
      .where(sql`${t.deletedAt} IS NULL`),
    // 檔案管理器的排序與 keyset 分頁：(排序欄位, id) 由索引直接給出順序（docs/architecture/backend/09-file.md §6.1）
    index('files_status_name_idx')
      .on(t.status, t.name, t.id)
      .where(sql`${t.deletedAt} IS NULL`),
    index('files_status_size_idx')
      .on(t.status, t.size, t.id)
      .where(sql`${t.deletedAt} IS NULL`),
    index('files_status_content_type_idx')
      .on(t.status, t.contentType)
      .where(sql`${t.deletedAt} IS NULL`),
    // 檔名的部分比對（ILIKE '%…%'）：btree 用不上，改用 pg_trgm 的 GIN 索引
    index('files_name_trgm_idx')
      .using('gin', sql`${t.name} gin_trgm_ops`)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type FileRow = typeof files.$inferSelect;
export type FileInsert = typeof files.$inferInsert;
