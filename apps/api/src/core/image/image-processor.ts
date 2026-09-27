import type { Readable } from 'node:stream';

/**
 * 影像處理的抽象層（docs/architecture/backend/09-file.md §5.4）。
 *
 * 業務模組只認識這個介面，不直接碰 sharp / libvips：
 * - 換實作（例：改呼叫外部的影像服務）只換 `ImageModule` 的 `useClass`；
 * - service 的單元測試注入假物件即可。
 *
 * 用 abstract class 而不是 interface，是因為它同時當作 Nest 的 DI token。
 */

export const IMAGE_FORMATS = ['jpeg', 'webp', 'avif', 'png'] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

export const IMAGE_FORMAT_CONTENT_TYPE: Record<ImageFormat, string> = {
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  png: 'image/png',
};

/** 已套用 EXIF 方向之後的尺寸（也就是使用者看到的方向）。 */
export interface ImageInfo {
  width: number;
  height: number;
  hasAlpha: boolean;
}

export interface RenderOptions {
  format: ImageFormat;
  /** 長邊上限（px），等比縮小、不放大；省略時維持原尺寸。 */
  maxEdge?: number;
  /** 1–100；PNG 不適用。 */
  quality?: number;
}

export interface RenderedImage {
  data: Buffer;
  contentType: string;
  width: number;
  height: number;
}

export interface DecodedImage {
  info: ImageInfo;
  /**
   * 以同一份解碼結果輸出一個版本；可以呼叫多次（例：同時產生全螢幕預覽與圖示預覽）。
   * 一律套用 EXIF 方向並移除中繼資料（GPS 等）；JPEG 一律是 progressive，有透明度時鋪白底。
   */
  render(options: RenderOptions): Promise<RenderedImage>;
}

export interface DecodeOptions {
  /** 讀入的位元組上限；超過就放棄，不把整個超大檔案讀進記憶體。 */
  maxBytes: number;
}

/** 不是支援的影像、內容損毀、超過位元組或像素上限。呼叫端據此把影像標為「無法處理」。 */
export class ImageDecodeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ImageDecodeError';
  }
}

export abstract class ImageProcessor {
  /** 讀入並解碼；失敗拋 `ImageDecodeError`。 */
  abstract decode(input: Readable | Buffer, options: DecodeOptions): Promise<DecodedImage>;
}
