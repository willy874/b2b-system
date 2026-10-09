/**
 * 可以由 CDN 送出的資源類型（docs/architecture/backend/09-file.md §16.2）。呼叫端簽網址時以 `{ cdn: '<資源類型>' }` 標出，
 * 再由 `FILE_CDN_RESOURCES` 決定哪些真的走 CDN（§17 D5）。前提是物件寫入後 **永不覆寫**：快取的 key 是物件路徑。
 *
 * - `fileVariant`：檔案的影像變體與轉出的格式（`variants/`，modules/file）
 * - `imageAsset`：圖片資產的主檔與變體（`images/`，modules/image）
 * - `galleryItem`：圖片庫的變體（`gallery/`，之後的 modules/gallery）
 *
 * 這個檔案不 import 任何東西：`core/config/env.schema.ts` 以它驗證環境變數。
 */
export const CDN_RESOURCE_TYPES = ['fileVariant', 'imageAsset', 'galleryItem'] as const;

export type CdnResource = (typeof CDN_RESOURCE_TYPES)[number];

export function isCdnResource(value: string): value is CdnResource {
  return (CDN_RESOURCE_TYPES as readonly string[]).includes(value);
}

/** `FILE_CDN_RESOURCES` 的逗號分隔清單 → 資源類型；有不認得的值時回錯誤訊息。 */
export function parseCdnResources(value: string): ReadonlySet<CdnResource> | string {
  const resources = new Set<CdnResource>();
  for (const item of value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)) {
    if (!isCdnResource(item)) {
      return `不認得的資源類型「${item}」（可用：${CDN_RESOURCE_TYPES.join(', ')}）`;
    }
    resources.add(item);
  }
  return resources;
}
