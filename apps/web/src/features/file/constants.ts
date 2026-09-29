import type { FileCategory, FileSortField } from '@/apis/file/types';
import type { FileKind } from '@/core/file';

/** 後端 `FILE_CATEGORIES`（篩選分類）。 */
export const FILE_CATEGORIES = [
  'image',
  'video',
  'audio',
  'text',
  'document',
  'archive',
  'other',
] as const satisfies readonly FileCategory[];

export const FILE_CATEGORY_LABEL_KEY = {
  image: 'file.category.image',
  video: 'file.category.video',
  audio: 'file.category.audio',
  text: 'file.category.text',
  document: 'file.category.document',
  archive: 'file.category.archive',
  other: 'file.category.other',
} as const satisfies Record<FileCategory, string>;

/** 列表可排序的欄位（後端白名單）。 */
export const FILE_SORT_FIELDS = [
  'createdAt',
  'name',
  'size',
] as const satisfies readonly FileSortField[];

export const FILE_SORT_LABEL_KEY = {
  createdAt: 'file.sort.createdAt',
  name: 'file.sort.name',
  size: 'file.sort.size',
} as const satisfies Record<FileSortField, string>;

export const FILE_KIND_LABEL_KEY = {
  image: 'file.kind.image',
  video: 'file.kind.video',
  audio: 'file.kind.audio',
  text: 'file.kind.text',
  code: 'file.kind.code',
  pdf: 'file.kind.pdf',
  spreadsheet: 'file.kind.spreadsheet',
  presentation: 'file.kind.presentation',
  document: 'file.kind.document',
  archive: 'file.kind.archive',
  font: 'file.kind.font',
  other: 'file.kind.other',
} as const satisfies Record<FileKind, string>;

/** 每頁筆數的選項（分頁模式）；無限捲動每次載入同樣的筆數。 */
export const FILE_PAGE_SIZES = [30, 60, 120] as const;

/** 縮圖的長邊（px）：卡片最寬約 240 px，2 倍像素密度仍清晰。 */
export const THUMBNAIL_MAX_DIMENSION = 480;
/** 後端 `THUMBNAIL_MAX_SIZE`；上傳政策還沒載入時的保守預設。 */
export const DEFAULT_THUMBNAIL_MAX_BYTES = 512 * 1024;
/** 同時上傳幾個檔案（全域佇列的 `concurrency`）；大檔另外在檔案內並行上傳分塊。 */
export const UPLOAD_CONCURRENCY = 3;
/** 沒有縮圖的圖片，小於這個大小才直接拿原檔當預覽，避免列表下載一堆大圖。 */
export const INLINE_PREVIEW_MAX_SIZE = 2 * 1024 * 1024;
/** 後端 `MAX_FOLDER_PATHS`：上傳資料夾時一次確保的路徑數，超過就分批送。 */
export const FOLDER_PATHS_PER_REQUEST = 1000;
