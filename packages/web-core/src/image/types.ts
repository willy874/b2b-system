/**
 * api 回應裡的一張圖（api 的 `ImageSourcesSchema`，docs/architecture/backend/25-image.md §3）。
 * web-core 不依賴 `@b2b-system/api-sdk`（各 app 的端點不同），所以這裡以結構寫一份；app 拿到的 SDK 型別可以直接傳進來。
 */
export interface ImageSourceVariant {
  /** 主格式、預設尺寸。 */
  src: string;
  /** `url 1x, url 2x` 或 `url 480w, url 1280w`。 */
  srcSet: string;
  /** 其他格式（例：WebP），放在 `<img>` 前面的 `<source>`。 */
  sources: ReadonlyArray<{ type: string; srcSet: string }>;
  width: number;
  height: number;
}

export interface ImageSources {
  width: number;
  height: number;
  /** 這一組網址最早到期的時間（ISO 8601）。 */
  expiresAt: string;
  /** 具名的版本（例：頭像的 `sm`、`md`、`lg`）。 */
  variants: Readonly<Record<string, ImageSourceVariant>>;
}
