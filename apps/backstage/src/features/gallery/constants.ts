/** 圖片庫收的型別（與後端的 `GALLERY_CONTENT_TYPES` 相同，docs/architecture/backend/26-gallery.md §4）。 */
export const GALLERY_CONTENT_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/tiff',
];

/** HEIC／HEIF（iPhone 的預設格式）：sharp 預編譯的 libvips 不能解碼，選檔時就擋下並提示匯出成 JPEG（D6）。 */
export const HEIC_TYPES: readonly string[] = ['image/heic', 'image/heif'];
export const HEIC_EXTENSION = /\.(heic|heif)$/i;

/** 同時上傳幾張：單次 PUT、每張最多 50 MiB。 */
export const GALLERY_UPLOAD_CONCURRENCY = 4;

/** 列高（等高排列）或格子大小（方格）的選項，px。 */
export const GALLERY_ROW_HEIGHTS = [120, 180, 240, 320] as const;
export type GalleryRowHeight = (typeof GALLERY_ROW_HEIGHTS)[number];

/** 窄螢幕的寬度（px）：預設方格、列高最小。 */
export const GALLERY_NARROW_WIDTH = 640;

/** 檢視器的幻燈片間隔（秒）。 */
export const GALLERY_SLIDESHOW_INTERVALS = [3, 5, 10] as const;

/** 檢視器前後各預先載入幾張的 `large`。 */
export const GALLERY_PRELOAD_NEIGHBORS = 2;

/** 一次最多逐張觸發下載幾張（打包下載是第二批，後端 D8）。 */
export const GALLERY_DOWNLOAD_MAX = 50;

/** 從其他來源加入一次最多幾張（後端的 `GALLERY_FROM_SOURCE_MAX`）。 */
export const GALLERY_FROM_SOURCE_MAX = 100;

/** 選圖、從其他來源加入用的過濾用途（後端的 `GALLERY_IMAGE_USAGE`）。 */
export const GALLERY_IMAGE_USAGE = 'gallery.item';

/** 處理失敗的原因 → 語系 key。 */
export const GALLERY_FAILURE_LABEL_KEY = {
  notImage: 'gallery.failure.notImage',
  typeNotAllowed: 'gallery.failure.typeNotAllowed',
  tooLarge: 'gallery.failure.tooLarge',
  missing: 'gallery.failure.missing',
} as const;

/** 從其他來源加入時略過的原因 → 語系 key。 */
export const GALLERY_SKIP_LABEL_KEY = {
  typeNotAllowed: 'gallery.addFromSource.reason.typeNotAllowed',
  tooLarge: 'gallery.addFromSource.reason.tooLarge',
  alreadyAdded: 'gallery.addFromSource.reason.alreadyAdded',
  notFound: 'gallery.addFromSource.reason.notFound',
} as const;
