import { IMAGE_FORMAT_EXTENSION } from './image-processor';
import type {
  DecodedImage,
  ImageFormat,
  ImageInfo,
  ImageRegion,
  RenderedImage,
} from './image-processor';

/**
 * 影像的格式政策（docs/architecture/backend/25-image.md §11 D9）：檔案的變體、圖片資產、圖片庫共用，尺寸由各模組決定。
 * 一律套用 EXIF 方向並移除中繼資料（`DecodedImage.render` 保證）。
 */

/** 主格式：progressive JPEG；有透明度的圖改用 WebP，免得鋪上底色。 */
export function primaryFormatOf(info: Pick<ImageInfo, 'hasAlpha'>): ImageFormat {
  return info.hasAlpha ? 'webp' : 'jpeg';
}

/**
 * 處理時產生的格式，主格式在前（docs/architecture/backend/25-image.md D2）：主格式 ＋ WebP，瀏覽器以 `<picture>` 選；
 * 主格式已經是 WebP 時只有一種。不做 AVIF（編碼慢）。
 */
export function deliveryFormatsOf(info: Pick<ImageInfo, 'hasAlpha'>): ImageFormat[] {
  const primary = primaryFormatOf(info);
  return primary === 'webp' ? ['webp'] : [primary, 'webp'];
}

/** 一組尺寸裡的一個：`maxEdge` 是長邊上限（px），省略時維持原尺寸；比上限小的不放大。 */
export interface RenditionSpec {
  name: string;
  maxEdge?: number;
}

export interface Rendition extends RenderedImage {
  name: string;
  format: ImageFormat;
}

export interface RenderRenditionsOptions {
  renditions: readonly RenditionSpec[];
  formats: readonly ImageFormat[];
  /** 先裁切再縮放（例：頭像的 1:1 裁切）。 */
  extract?: ImageRegion;
}

/**
 * 以同一份解碼結果輸出每個尺寸 × 格式。依序而不是同時 render：每個版本各自需要一份解碼緩衝，
 * 同時做會讓尖峰記憶體成倍增加。呼叫端負責 `decoded.dispose()`。
 */
export async function renderRenditions(
  decoded: DecodedImage,
  options: RenderRenditionsOptions,
): Promise<Rendition[]> {
  const results: Rendition[] = [];
  for (const spec of options.renditions) {
    for (const format of options.formats) {
      // oxlint-disable-next-line no-await-in-loop -- 依序輸出，理由見上方
      const rendered = await decoded.render({
        format,
        maxEdge: spec.maxEdge,
        extract: options.extract,
      });
      results.push({ ...rendered, name: spec.name, format });
    }
  }
  return results;
}

/**
 * 一個版本的物件 key：`<prefix>/<name>.<副檔名>`（例：`images/<id>/r3/sm@2x.webp`）。
 * prefix 帶版本號，物件寫入後永不覆寫（docs/architecture/backend/25-image.md R2）。
 */
export function renditionKey(prefix: string, name: string, format: ImageFormat): string {
  return `${prefix}/${name}.${IMAGE_FORMAT_EXTENSION[format]}`;
}
