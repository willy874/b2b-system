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
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type { ImageAssetVariants } from './image-assets';
import { users } from './users';

/**
 * 圖片庫的圖片狀態（docs/architecture/backend/26-gallery.md §3）：
 * - `pending`：已登記、等待瀏覽器直傳完成；
 * - `processing`：原檔已上傳（或已從其他來源複製），等 `gallery.process` 寫原檔、讀 EXIF、產生變體；
 * - `ready`：出現在圖片庫；
 * - `failed`：不是圖片、型別不收、太大或原檔不見（`failure_reason`），不再重試。
 */
export const GALLERY_ITEM_STATUSES = ['pending', 'processing', 'ready', 'failed'] as const;
export const galleryItemStatus = pgEnum('gallery_item_status', GALLERY_ITEM_STATUSES);
export type GalleryItemStatus = (typeof GALLERY_ITEM_STATUSES)[number];

/** EXIF 裡圖片庫顯示的欄位；**不存 GPS**（D5）。 */
export interface GalleryExif {
  make?: string;
  model?: string;
  lensMake?: string;
  lensModel?: string;
  /** mm。 */
  focalLength?: number;
  focalLength35mm?: number;
  fNumber?: number;
  /** 秒。 */
  exposureTime?: number;
  iso?: number;
  flashFired?: boolean;
}

/** 一個版本（`r<rev>/`）的變體；與圖片資產同一個形狀（組回應時由它算出全部網址，不必查物件儲存）。 */
export type GalleryItemVariants = ImageAssetVariants;

/**
 * 圖片庫的圖片（docs/architecture/backend/26-gallery.md §3）。與檔案管理器的 `files` 無關：加入時就複製，`source_ref_id` 不是外鍵。
 *
 * 物件：`gallery/<id>/upload`（直傳或複製來的，處理完就刪）、`gallery/<id>/original`（處理時依 D5 移除位置資訊後寫一次）、
 * `gallery/<id>/r<rev>/<尺寸>.<格式>`（變體；調整顯示方向寫到新的版本，D14）。每個物件只寫一次。
 */
export const galleryItems = pgTable(
  'gallery_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 顯示名稱：預設是去掉副檔名的檔名（≤ 255）。 */
    title: text('title').notNull(),
    /** 說明，同時當作替代文字（`alt`；≤ 1000）。 */
    description: text('description'),
    status: galleryItemStatus('status').notNull().default('pending'),
    /** `failed` 的原因（`notImage`、`typeNotAllowed`、`tooLarge`、`missing`）。 */
    failureReason: text('failure_reason'),
    /** pending 時是登記的型別；處理後是以檔頭判斷的型別。 */
    contentType: text('content_type').notNull(),
    /** 計入租戶容量的位元組：pending 時是登記（或複製來源）的大小，處理後是原檔（移除位置資訊之後）的大小。 */
    size: bigint('size', { mode: 'number' }).notNull(),
    /** 套用 EXIF 方向（不含 `display_rotation`）之後的尺寸；pending／processing 時是瀏覽器量的暫定值，可能是 null。 */
    width: integer('width'),
    height: integer('height'),
    /** 使用者調整的顯示方向（0 / 90 / 180 / 270，順時針；EXIF 方向寫錯時用）：變體依它產生，原檔不動。 */
    displayRotation: integer('display_rotation').notNull().default(0),
    /** 原檔（`gallery/<id>/original`）已經寫好。 */
    hasOriginal: boolean('has_original').notNull().default(false),
    /** 要求的變體版本：每次調整顯示方向遞增，`gallery.process` 寫到 `r<rev>/` 底下。 */
    rev: integer('rev').notNull().default(1),
    /** 已寫好的版本（組回應用它）；還沒有任何版本時是 null。 */
    variantRev: integer('variant_rev'),
    variants: jsonb('variants').$type<GalleryItemVariants>(),
    /** 變體的主格式（progressive JPEG，有透明度用 WebP）。 */
    variantFormat: text('variant_format'),
    /** 主色 `#rrggbb`：載入前的背景色；前端只當資料以 inline style 套用（D11）。 */
    dominantColor: text('dominant_color'),
    /** BlurHash（約 30 字元）：載入前的模糊預覽。 */
    placeholder: text('placeholder'),
    /** EXIF 的 `DateTimeOriginal`（有時區偏移時換算成 UTC；沒有時以租戶的 `general.defaultTimezone` 解讀）。 */
    takenAt: timestamp('taken_at', { withTimezone: true }),
    /** `coalesce(taken_at, created_at)`：時間軸與預設排序。 */
    sortAt: timestamp('sort_at', { withTimezone: true })
      .notNull()
      .generatedAlwaysAs(sql`coalesce(taken_at, created_at)`),
    exif: jsonb('exif').$type<GalleryExif>(),
    /** 原檔的位置資訊已依系統設定 `gallery.stripOriginalLocation` 移除（D5）。 */
    locationStripped: boolean('location_stripped').notNull().default(false),
    /** 原檔的 SHA-256：重複的圖片保留並標示（D7）。 */
    contentHash: text('content_hash'),
    /** `upload`，或加入時的來源（`file`…）。 */
    source: text('source').notNull(),
    /** 來源那一筆的 id（**不是外鍵**）；上傳是 null。 */
    sourceRefId: text('source_ref_id'),
    /** 來源那一筆的名稱（例：檔案的路徑與檔名），只是文字。 */
    sourceName: text('source_name'),
    /** 樂觀鎖：標題、說明、顯示方向的寫入遞增；相簿與標籤的變更不遞增。 */
    version: integer('version').notNull().default(1),
    /** 最後一次排入處理的時間；清理排程依它找出卡住的處理。 */
    queuedAt: timestamp('queued_at', { withTimezone: true }),
    /** 舊版本的變體可以刪除的時間（新版本寫好 ＋ 網址的效期，D14）；null 是沒有要清的。 */
    staleRevsPurgeAfter: timestamp('stale_revs_purge_after', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check('gallery_items_size_non_negative', sql`${t.size} >= 0`),
    check('gallery_items_display_rotation', sql`${t.displayRotation} IN (0, 90, 180, 270)`),
    check(
      'gallery_items_ready_described',
      sql`${t.status} <> 'ready' OR (${t.hasOriginal} AND ${t.width} IS NOT NULL AND ${t.height} IS NOT NULL AND ${t.variantRev} IS NOT NULL AND ${t.variants} IS NOT NULL)`,
    ),
    // 列表都只看 ready、沒刪除的：時間軸的 keyset、加入時間、標題
    index('gallery_items_sort_idx')
      .on(t.sortAt, t.id)
      .where(sql`${t.deletedAt} IS NULL AND ${t.status} = 'ready'`),
    index('gallery_items_created_idx')
      .on(t.createdAt, t.id)
      .where(sql`${t.deletedAt} IS NULL AND ${t.status} = 'ready'`),
    index('gallery_items_title_idx')
      .on(t.title, t.id)
      .where(sql`${t.deletedAt} IS NULL AND ${t.status} = 'ready'`),
    // 標題與說明的部分比對（ILIKE '%…%'）：btree 用不上，改用 pg_trgm 的 GIN 索引
    index('gallery_items_text_trgm_idx')
      .using('gin', sql`(${t.title} || ' ' || coalesce(${t.description}, '')) gin_trgm_ops`)
      .where(sql`${t.deletedAt} IS NULL AND ${t.status} = 'ready'`),
    // 重複的提示（D7）與「已經加入過」的判斷（§8）
    index('gallery_items_hash_idx')
      .on(t.contentHash)
      .where(sql`${t.deletedAt} IS NULL AND ${t.contentHash} IS NOT NULL`),
    index('gallery_items_source_idx')
      .on(t.source, t.sourceRefId)
      .where(sql`${t.deletedAt} IS NULL AND ${t.sourceRefId} IS NOT NULL`),
    // 上傳者的「處理中 N 張」與每人登記的上限
    index('gallery_items_uploads_idx')
      .on(t.createdBy, t.status)
      .where(sql`${t.status} <> 'ready'`),
    // 清理：卡住的處理、舊版本的變體、回收桶
    index('gallery_items_queued_idx')
      .on(t.queuedAt)
      .where(sql`${t.status} IN ('pending', 'processing')`),
    index('gallery_items_stale_revs_idx')
      .on(t.staleRevsPurgeAfter)
      .where(sql`${t.staleRevsPurgeAfter} IS NOT NULL`),
    index('gallery_items_deleted_idx')
      .on(t.deletedAt)
      .where(sql`${t.deletedAt} IS NOT NULL`),
  ],
);

/** 相簿（不巢狀）。張數與封面在查詢時算（相簿數量少；軟刪除與還原的圖片不必維護計數）。 */
export const galleryAlbums = pgTable(
  'gallery_albums',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    /** 封面；null 時用相簿裡最新的一張（依 `sort_at`）。封面的圖片永久刪除時清空。 */
    coverItemId: uuid('cover_item_id').references(() => galleryItems.id, {
      onDelete: 'set null',
    }),
    version: integer('version').notNull().default(1),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // 名稱不分大小寫唯一（未刪除者之間）
    uniqueIndex('gallery_albums_name_key')
      .on(sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} IS NULL`),
    index('gallery_albums_deleted_idx')
      .on(t.deletedAt)
      .where(sql`${t.deletedAt} IS NOT NULL`),
  ],
);

/** 圖片與相簿的多對多（一張圖可以在多個相簿）。相簿或圖片永久刪除時一起刪（CASCADE）；軟刪除時保留，還原時關聯一起回來。 */
export const galleryAlbumItems = pgTable(
  'gallery_album_items',
  {
    albumId: uuid('album_id')
      .notNull()
      .references(() => galleryAlbums.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => galleryItems.id, { onDelete: 'cascade' }),
    addedBy: uuid('added_by'),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.albumId, t.itemId] }),
    index('gallery_album_items_item_idx').on(t.itemId),
  ],
);

export type GalleryItemRow = typeof galleryItems.$inferSelect;
export type GalleryItemInsert = typeof galleryItems.$inferInsert;
export type GalleryAlbumRow = typeof galleryAlbums.$inferSelect;
export type GalleryAlbumInsert = typeof galleryAlbums.$inferInsert;
