import { isBrowserImage } from './fileType';
import type { ThumbnailGenerator } from './registry';

/** 縮圖用 WebP：同畫質下比 JPEG 小，且保留透明（圖示、素材常有透明底）。 */
const THUMBNAIL_TYPE = 'image/webp';
const QUALITY = 0.8;
/** 超過這個像素數不解碼：解一張 1 億像素的圖要數百 MB 記憶體，寧可沒有縮圖。 */
const MAX_SOURCE_PIXELS = 50_000_000;

async function encode(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Blob | undefined> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type: THUMBNAIL_TYPE, quality: QUALITY });
  }
  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(blob ?? undefined), THUMBNAIL_TYPE, QUALITY),
  );
}

function createCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * 瀏覽器能解碼的點陣圖 → 長邊 `maxDimension` 的 WebP。
 * SVG 不產生（本身就是向量、通常很小，列表直接用原檔）；GIF 只取第一格。
 */
export const imageThumbnailGenerator: ThumbnailGenerator = {
  id: 'image',
  canGenerate: (file) =>
    isBrowserImage(file.type) &&
    file.type !== 'image/svg+xml' &&
    typeof createImageBitmap === 'function',
  async generate(file, { maxDimension, signal }) {
    const bitmap = await createImageBitmap(file);
    try {
      if (signal?.aborted) return undefined;
      if (bitmap.width * bitmap.height > MAX_SOURCE_PIXELS) return undefined;
      const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = createCanvas(width, height);
      const context = canvas.getContext('2d') as
        | OffscreenCanvasRenderingContext2D
        | CanvasRenderingContext2D
        | null;
      if (!context) return undefined;
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, width, height);
      return await encode(canvas);
    } finally {
      bitmap.close();
    }
  },
};
