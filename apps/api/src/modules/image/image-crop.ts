import type { ImageRegion } from '@/core/image';
import type { ImageCrop } from '@/db/schema';

/**
 * 裁切以 **比例**（0～1，相對於轉正之後的圖）表示，而不是像素（docs/architecture/backend/25-image.md §15.5）：
 * 前端在裁切框裡看到的是原檔、瀏覽器縮圖或主檔，三者的像素都不同；以比例表示就不必知道伺服器的主檔被縮成多大。
 * 套用時才依主檔的尺寸換算成像素。
 */

/** 比例允許的誤差：前端以浮點數計算，邊界可能是 1.0000000002。 */
const EPSILON = 1e-6;

/** 比例的裁切是否在圖片之內、有面積。 */
export function isValidCrop(crop: ImageCrop): boolean {
  const values = [crop.x, crop.y, crop.width, crop.height];
  return (
    values.every(Number.isFinite) &&
    crop.x >= -EPSILON &&
    crop.y >= -EPSILON &&
    crop.width > 0 &&
    crop.height > 0 &&
    crop.x + crop.width <= 1 + EPSILON &&
    crop.y + crop.height <= 1 + EPSILON
  );
}

/**
 * 換算成主檔上的像素範圍。用途有比例（`aspectRatio`，寬 ÷ 高）時修正成剛好那個比例：
 * 前端的裁切框照比例拉，換算成整數像素後差一兩個像素，以寬為準重算高（放不下就以高為準）。
 * 沒有裁切但有比例時取中央最大的範圍（例：頭像沒裁就上傳）。沒有裁切也沒有比例回 undefined（整張）。
 */
export function toPixelRegion(
  crop: ImageCrop | null | undefined,
  size: { width: number; height: number },
  aspectRatio?: number,
): ImageRegion | undefined {
  if (!crop && aspectRatio === undefined) return undefined;
  const base = crop ?? centerCrop(size, aspectRatio ?? 1);
  let left = clamp(Math.round(base.x * size.width), 0, size.width - 1);
  let top = clamp(Math.round(base.y * size.height), 0, size.height - 1);
  let width = clamp(Math.round(base.width * size.width), 1, size.width - left);
  let height = clamp(Math.round(base.height * size.height), 1, size.height - top);
  if (aspectRatio !== undefined) {
    const fitted = Math.max(1, Math.round(width / aspectRatio));
    if (top + fitted <= size.height) {
      height = fitted;
    } else {
      height = size.height - top;
      width = clamp(Math.round(height * aspectRatio), 1, size.width - left);
    }
  }
  left = clamp(left, 0, size.width - width);
  top = clamp(top, 0, size.height - height);
  return { left, top, width, height };
}

/** 依比例取中央最大的範圍（以比例表示）。 */
export function centerCrop(
  size: { width: number; height: number },
  aspectRatio: number,
): ImageCrop {
  const imageRatio = size.width / size.height;
  if (imageRatio > aspectRatio) {
    const width = aspectRatio / imageRatio;
    return { x: (1 - width) / 2, y: 0, width, height: 1 };
  }
  const height = imageRatio / aspectRatio;
  return { x: 0, y: (1 - height) / 2, width: 1, height };
}

/** 裁切（或整張）之後的尺寸。 */
export function croppedSize(
  crop: ImageCrop | null | undefined,
  size: { width: number; height: number },
  aspectRatio?: number,
): { width: number; height: number } {
  const region = toPixelRegion(crop, size, aspectRatio);
  return region ? { width: region.width, height: region.height } : size;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
