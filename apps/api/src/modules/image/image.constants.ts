import { IMAGE_FORMAT_EXTENSION } from '@/core/image';
import type { ImageFormat } from '@/core/image';

/**
 * 圖片資產的常數與物件 key（docs/architecture/backend/25-image.md §15）。
 * 物件都在 `images/<id>/` 底下；每個物件只寫一次（R2），換內容就寫到新的 `r<rev>/`。
 */

/** 受管理的前綴：`file.maintenance` 只管 `files/`、`thumbnails/`、`variants/`，這裡由 `image.maintenance` 對帳。 */
export const IMAGE_KEY_PREFIX = 'images/';

/** 瀏覽器直傳、或從其他來源複製來的原檔；處理完就刪。 */
export function uploadKeyOf(id: string): string {
  return `${IMAGE_KEY_PREFIX}${id}/upload`;
}

/** 正規化之後的主檔（轉正、長邊縮到 `IMAGE_MASTER_MAX_EDGE`、移除中繼資料），不裁切。 */
export function masterKeyOf(id: string, format: ImageFormat): string {
  return `${IMAGE_KEY_PREFIX}${id}/master.${IMAGE_FORMAT_EXTENSION[format]}`;
}

/** 一個版本的變體前綴：`images/<id>/r<rev>`，物件是 `<prefix>/<尺寸>.<副檔名>`（`renditionKey`）。 */
export function revPrefixOf(id: string, rev: number): string {
  return `${IMAGE_KEY_PREFIX}${id}/r${rev}`;
}

/** 物件 key 所屬的資產 id；不是 `images/<uuid>/…` 的 key 回 undefined。 */
export function assetIdOfKey(key: string): string | undefined {
  const match = /^images\/([0-9a-f-]{36})\//.exec(key);
  return match?.[1];
}

/** 物件 key 所屬的版本（`images/<id>/r<rev>/…`）；主檔與原檔回 undefined。 */
export function revOfKey(key: string): number | undefined {
  const match = /^images\/[0-9a-f-]{36}\/r(\d+)\//.exec(key);
  return match ? Number(match[1]) : undefined;
}

/** 主檔的長邊上限（px）：手機的 4800 萬畫素照片不必整張留著。 */
export const IMAGE_MASTER_MAX_EDGE = 4096;

/** 每人同時處理中（`pending`）的資產上限：上傳不需要權限，靠它與容量擋住濫用（§15.4）。 */
export const IMAGE_PENDING_PER_USER = 10;

/** 沒被認領（上傳了但沒按儲存）的資產保留多久（毫秒）。 */
export const IMAGE_UNCLAIMED_TTL_MS = 24 * 60 * 60 * 1000;

/** 殘留物件（查不到資產的 `images/<id>/…`）至少要這麼舊才刪：剛登記、交易還沒提交的不會被誤判。 */
export const IMAGE_ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/** 處理排入後超過這麼久還沒好，就重新排入（背景工作的重試已經用完、或工作遺失）。 */
export const IMAGE_STUCK_AFTER_MS = 30 * 60 * 1000;

/** 「最近使用」最多列幾張。 */
export const IMAGE_RECENT_LIMIT = 30;

/** 一輪清理最多處理幾筆（每一步各自計算）：剩下的下一輪再做。 */
export const IMAGE_MAINTENANCE_BATCH = 200;

/** 內建的來源 id。檔案、圖片庫由各自的模組登記；這裡只列出 `modules/image` 自己認得的。 */
export const IMAGE_SOURCE = {
  UPLOAD: 'upload',
  RECENT: 'recent',
} as const;

/** 處理失敗的原因（`image_assets.failure_reason`）；前端依它顯示訊息。 */
export const IMAGE_FAILURE_REASONS = [
  'notImage',
  'typeNotAllowed',
  'tooLarge',
  'tooSmall',
  'missing',
] as const;
export type ImageFailureReason = (typeof IMAGE_FAILURE_REASONS)[number];
