/** 稽核 `file.update` 時比對的欄位。 */
export const FILE_AUDIT_FIELDS = ['name'] as const;

/**
 * 物件儲存的 key 只由 id 決定，與使用者給的檔名無關：
 * 改名不必搬物件，也不會有編碼、重名、路徑穿越的問題。
 */
export function storageKeyOf(fileId: string): string {
  return `files/${fileId}`;
}

/** 縮圖與原檔分開存：刪除時兩個都要刪。 */
export function thumbnailKeyOf(fileId: string): string {
  return `thumbnails/${fileId}`;
}

/**
 * 縮圖由瀏覽器在上傳時產生（前端 `core/file` 的縮圖產生器），伺服器不解碼圖片：
 * 不必在 api 裝影像處理的原生套件，也不佔 api 的 CPU。這裡只限制型別與大小。
 */
export const THUMBNAIL_CONTENT_TYPES = ['image/webp', 'image/jpeg', 'image/png'] as const;
export const THUMBNAIL_MAX_SIZE = 512 * 1024;

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
