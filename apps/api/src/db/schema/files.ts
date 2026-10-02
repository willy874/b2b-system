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

import { fileFolders } from './file-folders';
import { users } from './users';

/**
 * `pending`：已登記、等待瀏覽器直傳到物件儲存；`ready`：已確認物件存在且大小相符。
 * 見 docs/architecture/backend/09-file.md §4。
 */
export const FILE_STATUSES = ['pending', 'ready'] as const;
export const fileStatus = pgEnum('file_status', FILE_STATUSES);
export type FileStatus = (typeof FILE_STATUSES)[number];

/**
 * 影像變體（全螢幕預覽、圖示預覽）的狀態。見 docs/architecture/backend/09-file.md §5.4。
 * - `none`：不是伺服器能處理的影像（或還沒完成上傳）；
 * - `pending`：等待產生（上傳完成後排入，或維護排程補產生）；
 * - `ready`：兩個變體都已寫入物件儲存，`image_*` 欄位有值；
 * - `failed`：解碼失敗（內容損毀、超過尺寸上限），不再重試。
 */
export const FILE_VARIANT_STATUSES = ['none', 'pending', 'ready', 'failed'] as const;
export const fileVariantStatus = pgEnum('file_variant_status', FILE_VARIANT_STATUSES);
export type FileVariantStatus = (typeof FILE_VARIANT_STATUSES)[number];

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
    variantStatus: fileVariantStatus('variant_status').notNull().default('none'),
    /** 套用 EXIF 方向後的原圖尺寸；`variant_status = 'ready'` 才有值。 */
    imageWidth: integer('image_width'),
    imageHeight: integer('image_height'),
    /** 變體的主格式（`jpeg`：progressive JPEG；`webp`：有透明度的圖）；其他格式依請求另外轉出。 */
    variantFormat: text('variant_format'),
    /** 所在的資料夾；null 是根目錄（docs/architecture/backend/09-file.md §4.2）。 */
    folderId: uuid('folder_id').references(() => fileFolders.id, { onDelete: 'restrict' }),
    /**
     * 一次刪除操作的識別（docs/architecture/backend/14-revisions.md §9.2 D5）：同一次刪除（刪除檔案、遞迴刪除資料夾）
     * 軟刪除的列帶同一個值，還原資料夾時只還原同一批。未刪除時為 null；R4a 之前刪除的列也是 null。
     */
    deletionId: uuid('deletion_id'),

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
    check(
      'files_variant_ready_described',
      sql`${t.variantStatus} <> 'ready' OR (${t.imageWidth} IS NOT NULL AND ${t.imageHeight} IS NOT NULL AND ${t.variantFormat} IS NOT NULL)`,
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
    // 檔案管理器一次只列一個資料夾：先以 folder_id 縮小範圍，再依排序欄位排序
    index('files_folder_created_at_idx')
      .on(t.folderId, t.createdAt, t.id)
      .where(sql`${t.deletedAt} IS NULL`),
    // 依上傳者篩選（`GET /files?uploaderId=`）：沒有它就要掃過所有未刪除的檔案
    index('files_created_by_created_at_idx')
      .on(t.createdBy, t.createdAt)
      .where(sql`${t.deletedAt} IS NULL`),
    index('files_status_content_type_idx')
      .on(t.status, t.contentType)
      .where(sql`${t.deletedAt} IS NULL`),
    // 維護排程找「等待產生影像變體」的檔案；絕大多數列不是 pending，部分索引很小
    index('files_variant_pending_idx')
      .on(t.uploadedAt)
      .where(sql`${t.variantStatus} = 'pending' AND ${t.deletedAt} IS NULL`),
    // 回收桶：還原資料夾時找同一批刪除的檔案（docs/architecture/backend/13-trash.md §7）
    index('files_deletion_id_idx')
      .on(t.deletionId)
      .where(sql`${t.deletedAt} IS NOT NULL`),
    // 檔名的部分比對（ILIKE '%…%'）：btree 用不上，改用 pg_trgm 的 GIN 索引
    index('files_name_trgm_idx')
      .using('gin', sql`${t.name} gin_trgm_ops`)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type FileRow = typeof files.$inferSelect;
export type FileInsert = typeof files.$inferInsert;
