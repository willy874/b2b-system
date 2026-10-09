/**
 * 圖片庫的常數與物件 key（docs/architecture/backend/26-gallery.md）。
 * 物件都在 `gallery/<id>/` 底下；每個物件只寫一次（D14）：原檔寫一次，變體依版本寫到 `r<rev>/`。
 */

/** 受管理的前綴：`file.maintenance`、`image.maintenance` 不碰它，由 `gallery.maintenance` 對帳。 */
export const GALLERY_KEY_PREFIX = 'gallery/';

/** 瀏覽器直傳、或從其他來源複製來的檔案；處理完就刪。 */
export function uploadKeyOf(id: string): string {
  return `${GALLERY_KEY_PREFIX}${id}/upload`;
}

/** 原檔（依系統設定移除位置資訊之後）：處理時寫一次，之後不再改。 */
export function originalKeyOf(id: string): string {
  return `${GALLERY_KEY_PREFIX}${id}/original`;
}

/** 一個版本的變體前綴：`gallery/<id>/r<rev>`，物件是 `<prefix>/<尺寸>.<副檔名>`。 */
export function revPrefixOf(id: string, rev: number): string {
  return `${GALLERY_KEY_PREFIX}${id}/r${rev}`;
}

/** 物件 key 所屬的圖片 id；不是 `gallery/<uuid>/…` 的 key 回 undefined。 */
export function itemIdOfKey(key: string): string | undefined {
  return /^gallery\/([0-9a-f-]{36})\//.exec(key)?.[1];
}

/** 物件 key 所屬的版本（`gallery/<id>/r<rev>/…`）；原檔與上傳回 undefined。 */
export function revOfKey(key: string): number | undefined {
  const match = /^gallery\/[0-9a-f-]{36}\/r(\d+)\//.exec(key);
  return match ? Number(match[1]) : undefined;
}

/** 下載用的副檔名（原檔的型別 → 副檔名）。 */
export const GALLERY_TYPE_EXTENSION: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/tiff': 'tiff',
};

/**
 * 圖片庫收的型別（§4）：與檔案的變體來源相同。不收 SVG（不讓 api 解析使用者給的 XML）；
 * 不收 HEIC／HEIF（sharp 預編譯的 libvips 不含 HEIC 解碼，D6）。GIF 與動態 WebP 只取第一格。
 */
export const GALLERY_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/tiff',
] as const;

/**
 * 變體的尺寸（長邊 px，§5）：`thumb` 給方格與小的等高排列（列高 ≤ 240 的 2x）、`medium` 給大的等高排列與預覽、
 * `large` 給檢視器的全螢幕。比原圖大的不放大（同一個尺寸的物件共用）。
 */
export const GALLERY_RENDITIONS = { thumb: 480, medium: 1280, large: 2560 } as const;
export type GalleryRendition = keyof typeof GALLERY_RENDITIONS;

/** 網址的效期（秒）：無限捲動與檢視器依 `expiresAt` 在到期前重抓。 */
export const GALLERY_URL_TTL = 3600;

/** BlurHash 解碼前縮小到的長邊（px）與分量。 */
export const GALLERY_PLACEHOLDER_EDGE = 32;

/** 一頁幾張（keyset）。 */
export const GALLERY_PAGE_SIZE = 100;
export const GALLERY_PAGE_SIZE_MAX = 200;

/** `POST /gallery/items/from-source` 一次最多幾筆。 */
export const GALLERY_FROM_SOURCE_MAX = 100;

/** 批次加入或移出相簿一次最多幾張。 */
export const GALLERY_ALBUM_ITEMS_MAX = 500;

/** 每人登記了但還沒完成上傳（`pending`）的上限：上傳的佇列一次只跑幾筆，這個數字只擋濫用。 */
export const GALLERY_PENDING_PER_USER = 50;

/** 登記後超過這麼久還沒完成上傳就放棄（清理排程刪除紀錄與物件、釋出容量）。 */
export const GALLERY_PENDING_TTL_MS = 24 * 60 * 60 * 1000;

/** 處理失敗的紀錄保留多久（上傳者在頁首看得到原因），之後由清理排程刪除。 */
export const GALLERY_FAILED_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 排入處理後超過這麼久還沒好，就重新排入（背景工作的重試已經用完、或工作遺失）。 */
export const GALLERY_STUCK_AFTER_MS = 30 * 60 * 1000;

/** 殘留物件（查不到圖片的 `gallery/<id>/…`）至少要這麼舊才刪：剛登記、交易還沒提交的不會被誤判。 */
export const GALLERY_ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/** 一輪清理每一步最多處理幾筆：剩下的下一輪再做。 */
export const GALLERY_MAINTENANCE_BATCH = 200;

/** 處理時讀原檔的位元組上限（feature 參數的上限 200 MiB）：移除位置資訊要整個檔案在記憶體裡。 */
export const GALLERY_READ_MAX_BYTES = 200 * 1024 * 1024;

/** 後端的圖片來源 id（選圖時的「圖片庫」分頁送來的 `source`）。 */
export const GALLERY_IMAGE_SOURCE = 'gallery';

/** 自行上傳的來源。 */
export const GALLERY_UPLOAD_SOURCE = 'upload';

/**
 * 「從其他來源加入」用的圖片用途（`ImageUsageRegistry`）：只用來讓其他來源（檔案管理）過濾出圖片庫收得下的圖，
 * 不能建立圖片資產（`filterOnly`）。
 */
export const GALLERY_IMAGE_USAGE = 'gallery.item';

/** 圖片庫的標籤組（docs/architecture/backend/18-tag.md §1.1）。 */
export const GALLERY_TAG_SCOPE = 'gallery';

/** 處理失敗的原因（`gallery_items.failure_reason`）；前端依它顯示訊息。 */
export const GALLERY_FAILURE_REASONS = [
  'notImage',
  'typeNotAllowed',
  'tooLarge',
  'missing',
] as const;
export type GalleryFailureReason = (typeof GALLERY_FAILURE_REASONS)[number];

/** 稽核的 `galleryItem.update` 記哪些欄位。 */
export const GALLERY_ITEM_AUDIT_FIELDS = ['title', 'description', 'displayRotation'] as const;
export const GALLERY_ALBUM_AUDIT_FIELDS = ['name', 'description', 'coverItemId'] as const;

/**
 * 一個 worker 程序同時處理幾張（`gallery.process` 的並行度）：解碼大圖很吃 CPU 與記憶體
 * （移除位置資訊時整個原檔在記憶體裡），與檔案的變體（`file.imageVariants`）各自計算。
 */
export const GALLERY_PROCESS_CONCURRENCY = 2;
