import { ChangeSource } from '@b2b-system/realtime';
import type { ChangeKind, ResourceChangeWire } from '@b2b-system/realtime';

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

// ── 下載網址的型別政策（docs/architecture/backend/09-file.md §7.2） ──

/**
 * 可以在租戶網域上 inline 顯示的型別：瀏覽器只會把它們當成被動內容（圖片、影音、純文字），不會執行。
 * `/storage` 與 backstage 同源，HTML、SVG、JS 若 inline 提供就能在租戶網域上執行腳本、偷 session。
 * PDF 不在內：瀏覽器的 PDF 檢視器在 `sandbox` CSP 下會被擋，改為下載。
 */
const INLINE_SAFE_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'text/plain',
]);
const INLINE_SAFE_PREFIXES = ['audio/', 'video/'] as const;

/** 在 `<img>` 裡顯示得出來、直接開啟卻會執行腳本的型別：保留型別（`<img>` 才畫得出來）但一律 attachment。 */
const IMAGE_ONLY_CONTENT_TYPES: ReadonlySet<string> = new Set(['image/svg+xml']);

/** 其他型別下載時一律以這個型別回應：瀏覽器不會解析、也不會執行。 */
export const OPAQUE_CONTENT_TYPE = 'application/octet-stream';

export function isInlineSafe(contentType: string): boolean {
  return (
    INLINE_SAFE_CONTENT_TYPES.has(contentType) ||
    INLINE_SAFE_PREFIXES.some((prefix) => contentType.startsWith(prefix))
  );
}

/**
 * 下載網址的 `Content-Disposition` 與回應型別：白名單以外一律 attachment，
 * 除了 SVG（保留型別給 `<img>` 用）都改成 `application/octet-stream`；`contentType` 為 undefined 是沿用物件的型別。
 */
export function downloadPolicyOf(contentType: string): {
  disposition: 'inline' | 'attachment';
  contentType: string | undefined;
} {
  if (isInlineSafe(contentType)) return { disposition: 'inline', contentType: undefined };
  if (IMAGE_ONLY_CONTENT_TYPES.has(contentType)) {
    return { disposition: 'attachment', contentType: undefined };
  }
  return { disposition: 'attachment', contentType: OPAQUE_CONTENT_TYPE };
}

// ── 影像變體（docs/architecture/backend/09-file.md §5.4） ──

/**
 * 伺服器會為這些型別產生影像變體（sharp 預編譯版本能解碼的格式）。
 * SVG 不在內：向量圖由瀏覽器直接顯示即可，也不讓 api 解析使用者給的 XML。
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

/**
 * 依請求轉出的格式的位元組上限：大圖的原圖轉成 PNG 可達數百 MiB（1 億像素的照片約 160 MiB）。
 * 超過就不存：`format=auto` 退回主格式（原圖則原封不動），明確指定的格式回 `FILE_IMAGE_TOO_LARGE`。
 * 與部署預設的 `FILE_STORAGE_MAX_OBJECT_SIZE`（apps/file-storage）相同，調整時一起改。
 */
export const IMAGE_CONVERSION_MAX_OUTPUT_SIZE = 128 * 1024 * 1024;

/** 每個 api 執行個體最多記住幾個「轉出後超過上限」的格式，免得每次請求都重新解碼一次大圖。 */
export const IMAGE_CONVERSION_OVERSIZED_MEMORY = 1000;

/**
 * 同一個程序同時處理影像的數量：解碼大圖很吃 CPU 與記憶體。worker 的變體產生（`file.imageVariants` 的並行度）
 * 與 http 程序依請求轉出其他格式各自套用。
 */
export const IMAGE_VARIANT_CONCURRENCY = 2;

/**
 * 變體排入後超過這個時間仍是 `pending`（工作用完重試、儲存服務暫時失敗），維護排程重新排入。
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

/**
 * 已用量的計數（`file_storage_usage`）以 `SUM(size)` 對帳的間隔（docs/architecture/backend/09-file.md §9）：
 * 維護排程每一輪都檢查，距上次對帳超過這個時間才真的加總。加總會掃過整張 `files` 並擋住同時的登記，所以一天一次。
 */
export const STORAGE_USAGE_RECONCILE_INTERVAL_MS = 24 * 60 * 60 * 1000;

// ── 推播（docs/architecture/backend/09-file.md §7） ──

/** 回收桶顯示「原本在哪裡」：由根往下的資料夾名稱 → `/素材/ui`；根目錄是 `/`。 */
export function folderPathOf(names: readonly string[] | undefined): string {
  return `/${(names ?? []).join('/')}`;
}

/** 無法逐筆列出受影響的 id 時（遞迴刪除、批次移動、還原資料夾）：前端退回失效該資源的所有實體。 */
export const ANY_ID = '*';

/** 根目錄在推播 `refs.fileFolder` 裡的代號（與 `GET /files?folderId=root` 相同）。 */
export const ROOT_FOLDER_REF = 'root';

/**
 * 一個檔案的變更推播：`refs.fileFolder` 帶所在的資料夾，前端只重抓正在看那個資料夾（與不分資料夾）的列表，
 * 其他資料夾的檔案管理器不動。
 */
export function fileChange(
  kind: ChangeKind,
  id: string,
  folderId: string | null,
): ResourceChangeWire {
  return {
    resource: ChangeSource.FILE,
    kind,
    id,
    refs: { [ChangeSource.FILE_FOLDER]: [folderId ?? ROOT_FOLDER_REF] },
  };
}

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
 * 前端的圖示與分類標籤依同一張表（`apps/backstage/src/core/file/fileType.ts`），改這裡要一起改。
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
