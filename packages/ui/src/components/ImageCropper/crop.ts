/** 裁切的範圍，以比例（0～1，相對於圖片）表示：與圖片實際顯示的大小、伺服器的主檔大小都無關。 */
export interface ImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 拖曳的角。 */
export type CropCorner = 'nw' | 'ne' | 'sw' | 'se';

/** 圖片的自然尺寸（像素）與限制：比例是寬 ÷ 高（像素），最小尺寸以自然像素計。 */
export interface CropBounds {
  naturalWidth: number;
  naturalHeight: number;
  aspectRatio?: number;
  minWidth?: number;
  minHeight?: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** 以比例表示時，裁切框的寬 ÷ 高（兩者的單位不同：寬是圖寬的比例、高是圖高的比例）。 */
function fractionRatio(bounds: CropBounds): number | undefined {
  return bounds.aspectRatio === undefined
    ? undefined
    : (bounds.aspectRatio * bounds.naturalHeight) / bounds.naturalWidth;
}

/** 最小寬、高（比例）。 */
function minFractions(bounds: CropBounds): { width: number; height: number } {
  return {
    width: Math.min(1, (bounds.minWidth ?? 1) / bounds.naturalWidth),
    height: Math.min(1, (bounds.minHeight ?? 1) / bounds.naturalHeight),
  };
}

/** 中央最大的範圍（有比例時照比例；沒有時整張）。 */
export function centeredCrop(bounds: CropBounds): ImageCrop {
  const ratio = fractionRatio(bounds);
  if (ratio === undefined) return { x: 0, y: 0, width: 1, height: 1 };
  const width = Math.min(1, ratio);
  const height = width / ratio;
  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
}

/** 平移：不超出圖片。 */
export function moveCrop(crop: ImageCrop, dx: number, dy: number): ImageCrop {
  return {
    ...crop,
    x: clamp(crop.x + dx, 0, 1 - crop.width),
    y: clamp(crop.y + dy, 0, 1 - crop.height),
  };
}

/**
 * 拖曳一個角：對角固定，寬依位移改變；有比例時高跟著寬走。不小於最小尺寸、不超出圖片。
 */
export function resizeCrop(
  crop: ImageCrop,
  corner: CropCorner,
  dx: number,
  dy: number,
  bounds: CropBounds,
): ImageCrop {
  const ratio = fractionRatio(bounds);
  const min = minFractions(bounds);
  const west = corner === 'nw' || corner === 'sw';
  const north = corner === 'nw' || corner === 'ne';
  // 固定的對角
  const anchorX = west ? crop.x + crop.width : crop.x;
  const anchorY = north ? crop.y + crop.height : crop.y;
  const maxWidth = west ? anchorX : 1 - anchorX;
  const maxHeight = north ? anchorY : 1 - anchorY;

  let width = clamp(crop.width + (west ? -dx : dx), min.width, maxWidth);
  let height: number;
  if (ratio === undefined) {
    height = clamp(crop.height + (north ? -dy : dy), min.height, maxHeight);
  } else {
    width = Math.min(width, maxHeight * ratio);
    width = Math.max(width, min.width, min.height * ratio);
    width = Math.min(width, maxWidth, maxHeight * ratio);
    height = width / ratio;
  }
  return {
    x: west ? anchorX - width : anchorX,
    y: north ? anchorY - height : anchorY,
    width,
    height,
  };
}

/** 外部給的值修正成合法的範圍（超出圖片、比例不符時取中央）。 */
export function normalizeCrop(crop: ImageCrop | undefined, bounds: CropBounds): ImageCrop {
  if (!crop) return centeredCrop(bounds);
  const width = clamp(crop.width, 0.0001, 1);
  const height = clamp(crop.height, 0.0001, 1);
  const ratio = fractionRatio(bounds);
  if (ratio !== undefined && Math.abs(width / height - ratio) > 0.01) return centeredCrop(bounds);
  return { x: clamp(crop.x, 0, 1 - width), y: clamp(crop.y, 0, 1 - height), width, height };
}
