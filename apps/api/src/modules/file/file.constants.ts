/** 稽核 `file.update` 時比對的欄位。 */
export const FILE_AUDIT_FIELDS = ['name'] as const;

/**
 * 物件儲存的 key 只由 id 決定，與使用者給的檔名無關：
 * 改名不必搬物件，也不會有編碼、重名、路徑穿越的問題。
 */
export function storageKeyOf(fileId: string): string {
  return `${ORIGINAL_KEY_PREFIX}${fileId}`;
}

export const ORIGINAL_KEY_PREFIX = 'files/';

/** 縮圖與原檔分開存：刪除時兩個都要刪。 */
export function thumbnailKeyOf(fileId: string): string {
  return `thumbnails/${fileId}`;
}

/**
 * 瀏覽器在上傳時產生的縮圖（前端 `core/file` 的縮圖產生器），這裡只限制型別與大小。
 * 伺服器能處理的圖片另有伺服器產生的影像變體（§5.4）優先；瀏覽器縮圖是其他類型與變體失敗時的退路。
 */
export const THUMBNAIL_CONTENT_TYPES = ['image/webp', 'image/jpeg', 'image/png'] as const;
export const THUMBNAIL_MAX_SIZE = 512 * 1024;

// ── 影像變體（docs/architecture/backend/09-file.md §5.4） ──

/**
 * 伺服器會為這些型別產生影像變體（sharp 預編譯版本能解碼的格式）。
 * SVG 不在內：向量圖由瀏覽器直接顯示即可，也不讓 api 解析使用者給的 XML。
 * migration `0008_file_image_variants.sql` 的補產生條件用同一份清單，改這裡要一起改。
 */
export const IMAGE_VARIANT_SOURCE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/tiff',
] as const;

export function isImageVariantSource(contentType: string): boolean {
  return (IMAGE_VARIANT_SOURCE_TYPES as readonly string[]).includes(contentType);
}

/** `original`：原圖；`preview`：全螢幕預覽；`thumbnail`：圖示預覽。 */
export const IMAGE_VARIANTS = ['original', 'preview', 'thumbnail'] as const;
export type ImageVariant = (typeof IMAGE_VARIANTS)[number];

/** 伺服器實體化的兩個縮小版本：長邊上限（px），等比縮小、不放大。 */
export const IMAGE_VARIANT_MAX_EDGE: Record<Exclude<ImageVariant, 'original'>, number> = {
  // 2560：涵蓋 1440p 螢幕與 1080p 的 Retina 全螢幕
  preview: 2560,
  // 480：卡片最大約 240 CSS px，2x 螢幕剛好
  thumbnail: 480,
};

/** 產生變體時讀入原圖的位元組上限；超過的圖片標為 `failed`，前端退回瀏覽器縮圖或類型圖示。 */
export const IMAGE_VARIANT_MAX_INPUT_SIZE = 128 * 1024 * 1024;

/** 同一個 api 執行個體同時產生變體的數量：解碼大圖很吃 CPU 與記憶體。 */
export const IMAGE_VARIANT_CONCURRENCY = 2;

/**
 * 變體排入後超過這個時間仍是 `pending`（執行個體重啟、儲存服務暫時失敗），維護排程重新排入。
 */
export const IMAGE_VARIANT_RETRY_AFTER_MS = 5 * 60 * 1000;

/** 變體與依請求轉出的其他格式都放在 `variants/<id>/` 底下：刪除時整個前綴一起刪。 */
export function variantPrefixOf(fileId: string): string {
  return `variants/${fileId}/`;
}

export function variantKeyOf(fileId: string, variant: ImageVariant, format: string): string {
  return `${variantPrefixOf(fileId)}${variant}.${format}`;
}

/**
 * 物件儲存裡由檔案模組管理的前綴；維護排程只對帳這些前綴，bucket 裡的其他東西不碰。
 * key 的第一段路徑之後緊接著檔案 id。
 */
export const MANAGED_KEY_PREFIXES = ['files/', 'thumbnails/', 'variants/'] as const;

const MANAGED_KEY_PATTERN =
  /^(?:files|thumbnails|variants)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/;

/** 從受管理的 key 取出檔案 id；不是這個模組產生的 key 回 `undefined`。 */
export function fileIdOfKey(key: string): string | undefined {
  return MANAGED_KEY_PATTERN.exec(key)?.[1];
}

/** 維護排程一次查資料庫或處理的筆數。 */
export const MAINTENANCE_BATCH_SIZE = 500;

// ── 資料夾（docs/architecture/backend/09-file.md §4.2） ──

/** 資料夾的最大深度：上傳資料夾時的路徑層數上限，也擋下失控的巢狀。 */
export const MAX_FOLDER_DEPTH = 32;
/** 上傳資料夾時一次確保的路徑數（前端依資料夾數分批送）。 */
export const MAX_FOLDER_PATHS = 1000;
/** 一次移動的檔案或資料夾數（各自的上限）。 */
export const MAX_MOVE_ITEMS = 1000;

/** 一次最多要幾塊的上傳網址（前端邊傳邊要，不必一次拿齊）。 */
export const MAX_PARTS_PER_REQUEST = 100;
/** S3 的上限。 */
export const MAX_PART_COUNT = 10_000;

/**
 * 列表的分類篩選（`GET /files?category=`）。`other` 是「不屬於其他任何一類」。
 * 前端的圖示與分類標籤依同一張表（`apps/web/src/core/file/fileType.ts`），改這裡要一起改。
 */
export const FILE_CATEGORIES = [
  'image',
  'video',
  'audio',
  'text',
  'document',
  'archive',
  'other',
] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];

export interface FileCategoryRule {
  /** `content_type LIKE '<prefix>%'`。 */
  prefixes: readonly string[];
  /** `content_type = '<type>'`。 */
  types: readonly string[];
}

export const FILE_CATEGORY_RULES: Record<Exclude<FileCategory, 'other'>, FileCategoryRule> = {
  image: { prefixes: ['image/'], types: [] },
  video: { prefixes: ['video/'], types: [] },
  audio: { prefixes: ['audio/'], types: [] },
  text: {
    prefixes: ['text/'],
    types: [
      'application/json',
      'application/ld+json',
      'application/xml',
      'application/javascript',
      'application/x-yaml',
      'application/yaml',
      'application/toml',
      'application/x-sh',
      'application/sql',
    ],
  },
  document: {
    prefixes: [
      'application/vnd.openxmlformats-officedocument.',
      'application/vnd.oasis.opendocument.',
    ],
    types: [
      'application/pdf',
      'application/msword',
      'application/vnd.ms-excel',
      'application/vnd.ms-powerpoint',
      'application/rtf',
    ],
  },
  archive: {
    prefixes: [],
    types: [
      'application/zip',
      'application/x-zip-compressed',
      'application/x-7z-compressed',
      'application/x-rar-compressed',
      'application/vnd.rar',
      'application/gzip',
      'application/x-gzip',
      'application/x-tar',
      'application/x-bzip2',
      'application/x-xz',
    ],
  },
};
