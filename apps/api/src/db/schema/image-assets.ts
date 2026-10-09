import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * 圖片資產的狀態（docs/architecture/backend/25-image.md §15）：
 * - `pending`：等待上傳或處理（`image.process`）；
 * - `ready`：主檔與第一版的變體都已寫入；
 * - `failed`：不是圖片、解碼失敗或不符合用途的限制（`failure_reason`），不再重試。
 */
export const IMAGE_ASSET_STATUSES = ['pending', 'ready', 'failed'] as const;
export const imageAssetStatus = pgEnum('image_asset_status', IMAGE_ASSET_STATUSES);
export type ImageAssetStatus = (typeof IMAGE_ASSET_STATUSES)[number];

/** 裁切的範圍（px），以轉正之後的主檔為準。 */
export interface ImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 一個版本（`r<rev>/`）的變體：組回應時由它算出全部網址，不必查物件儲存（docs/architecture/backend/25-image.md R5）。 */
export interface ImageAssetVariants {
  /** 裁切之後的尺寸。 */
  width: number;
  height: number;
  /** 主格式在前。 */
  formats: string[];
  renditions: Record<string, { width: number; height: number; sameAs?: string }>;
}

/**
 * 圖片資產（docs/architecture/backend/25-image.md §15）：與檔案管理器無關的圖片（頭像等）。
 * 所有來源（上傳、檔案管理、圖片庫、最近使用）的結果都是一筆新的資產；consumer 只存 `id`（R1）。
 *
 * 物件：`images/<id>/upload`（處理完就刪）、`images/<id>/master.<格式>`、`images/<id>/r<rev>/<尺寸>.<格式>`；每個物件只寫一次（R2）。
 * 不軟刪除：沒被認領或被換掉的資產由 `image.maintenance` 連同物件一起刪除（§15.6）。
 */
export const imageAssets = pgTable(
  'image_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 用途 id（例：`user.avatar`）：決定限制、尺寸與網址的效期。 */
    usage: text('usage').notNull(),
    status: imageAssetStatus('status').notNull().default('pending'),
    /** `failed` 的原因（`notImage`、`tooSmall`、`typeNotAllowed`、`tooLarge`、`missing`）。 */
    failureReason: text('failure_reason'),
    /** `upload`、`file`、`gallery`、`recent`：稽核與排查用。 */
    source: text('source').notNull(),
    /** 來源那一筆的 id（**不是外鍵**：原本那筆刪除不影響資產）；上傳是 null。 */
    sourceRefId: text('source_ref_id'),
    /** 原本的名稱（檔名；貼上的圖片以時間命名），給「最近使用」顯示。 */
    sourceName: text('source_name').notNull(),
    /** pending 時是登記的型別；ready 時是主檔的型別。 */
    contentType: text('content_type').notNull(),
    /** 計入租戶容量的位元組：pending 時是登記（或複製來源）的大小，ready 時是主檔的大小。 */
    size: bigint('size', { mode: 'number' }).notNull(),
    /** 主檔（轉正、縮到長邊 4096、移除中繼資料）的尺寸，未裁切。 */
    width: integer('width'),
    height: integer('height'),
    hasAlpha: boolean('has_alpha'),
    masterFormat: text('master_format'),
    /** 主檔的 SHA-256：「最近使用」以它去除重複。 */
    contentHash: text('content_hash'),
    /** 目前的裁切；null 是不裁切。 */
    crop: jsonb('crop').$type<ImageCrop>(),
    /** 要求的版本：每次重新裁切遞增，`image.process` 寫到 `r<rev>/` 底下。 */
    rev: integer('rev').notNull().default(1),
    /** 已寫好的版本（組回應用它）；還沒有任何版本時是 null。 */
    variantRev: integer('variant_rev'),
    variants: jsonb('variants').$type<ImageAssetVariants>(),
    /** 最後一次排入處理（`image.process`）的時間；還沒完成上傳是 null。清理排程依它找出卡住的處理。 */
    queuedAt: timestamp('queued_at', { withTimezone: true }),
    /** 舊版本的變體可以刪除的時間（新版本寫好 ＋ 網址的效期）；null 是沒有要清的。 */
    staleRevsPurgeAfter: timestamp('stale_revs_purge_after', { withTimezone: true }),
    /** 使用它的資源（`user` ＋ 使用者 id）；還沒被儲存時是 null。一個資產只屬於一個資源。 */
    ownerType: text('owner_type'),
    ownerId: uuid('owner_id'),
    /** 被換掉、或擁有者被永久刪除的時間：保留到回收桶的保留期限後由清理排程刪除。 */
    detachedAt: timestamp('detached_at', { withTimezone: true }),
    /** 使用者把它從「最近使用」移除的時間；不影響正在使用它的資源。 */
    hiddenFromRecentAt: timestamp('hidden_from_recent_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('image_assets_size_non_negative', sql`${t.size} >= 0`),
    check(
      'image_assets_ready_described',
      sql`${t.status} <> 'ready' OR (${t.width} IS NOT NULL AND ${t.height} IS NOT NULL AND ${t.masterFormat} IS NOT NULL AND ${t.variantRev} IS NOT NULL AND ${t.variants} IS NOT NULL)`,
    ),
    check('image_assets_owner_pair', sql`(${t.ownerType} IS NULL) = (${t.ownerId} IS NULL)`),
    // 「最近使用」：自己建立、可以用的圖，依建立時間新到舊
    index('image_assets_recent_idx')
      .on(t.createdBy, t.createdAt)
      .where(sql`${t.status} = 'ready' AND ${t.hiddenFromRecentAt} IS NULL`),
    // consumer 依擁有者找資產（永久刪除時解除）
    index('image_assets_owner_idx')
      .on(t.ownerType, t.ownerId)
      .where(sql`${t.ownerId} IS NOT NULL`),
    // 清理：沒被認領的（依建立時間）與被換掉的（依解除時間）
    index('image_assets_unclaimed_idx')
      .on(t.createdAt)
      .where(sql`${t.ownerId} IS NULL`),
    index('image_assets_detached_idx')
      .on(t.detachedAt)
      .where(sql`${t.detachedAt} IS NOT NULL`),
    // 卡住的處理：排入過、要求的版本還沒寫好
    index('image_assets_queued_idx')
      .on(t.queuedAt)
      .where(sql`${t.queuedAt} IS NOT NULL AND ${t.status} <> 'failed'`),
    index('image_assets_stale_revs_idx')
      .on(t.staleRevsPurgeAfter)
      .where(sql`${t.staleRevsPurgeAfter} IS NOT NULL`),
    // 每人處理中的上限（`IMAGE_PENDING_PER_USER`）
    index('image_assets_pending_idx')
      .on(t.createdBy)
      .where(sql`${t.status} = 'pending'`),
  ],
);

export type ImageAssetRow = typeof imageAssets.$inferSelect;
export type ImageAssetInsert = typeof imageAssets.$inferInsert;
