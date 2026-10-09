/** 寬高（像素）。 */
export interface ViewerSize {
  width: number;
  height: number;
}

/** 容器內的一點（像素，相對於容器的左上角）。 */
export interface ViewerPoint {
  x: number;
  y: number;
}

/**
 * 檢視狀態：圖片以原圖尺寸（`width` × `height`）擺放，左上角平移到 (`x`, `y`) 後以 `scale` 縮放
 * （`transform-origin: 0 0`）。`scale` 1 就是「100%」。
 */
export interface ViewerState {
  scale: number;
  x: number;
  y: number;
}

/** 縮放與平移的範圍。 */
export interface ZoomBounds {
  image: ViewerSize;
  container: ViewerSize;
  /** 最小縮放（通常是 `fitScale`）。 */
  minScale: number;
  /** 最大縮放（相對於 100%）。 */
  maxScale: number;
}

/** 由小到大的解析度之一；`pickLevel` 只看 `width`。 */
export interface ViewerLevelSize {
  width: number;
}

/** 縮放取到小數第 6 位。 */
function roundScale(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * 「符合視窗」的縮放：整張圖放得進容器（contain），但不放大超過 100%（小圖以原尺寸顯示）。
 * 尺寸不合法（還沒量到容器）時回傳 1。
 */
export function fitScale(image: ViewerSize, container: ViewerSize): number {
  if (![image.width, image.height, container.width, container.height].every(isPositive)) return 1;
  return Math.min(1, container.width / image.width, container.height / image.height);
}

/** 單一軸：比容器小時置中，比容器大時不讓邊緣露出空白。 */
function clampAxis(offset: number, displayed: number, container: number): number {
  if (displayed <= container) return (container - displayed) / 2;
  return Math.min(0, Math.max(container - displayed, offset));
}

/** 把平移限制在圖片邊緣之內（圖片比容器小的軸置中）。 */
export function clampOffset(
  state: ViewerState,
  image: ViewerSize,
  container: ViewerSize,
): ViewerState {
  return {
    scale: state.scale,
    x: clampAxis(state.x, image.width * state.scale, container.width),
    y: clampAxis(state.y, image.height * state.scale, container.height),
  };
}

/** 符合視窗、置中的狀態。 */
export function fitState(image: ViewerSize, container: ViewerSize): ViewerState {
  return clampOffset({ scale: fitScale(image, container), x: 0, y: 0 }, image, container);
}

/**
 * 以 `point` 為中心縮放 `factor` 倍：縮放前後游標下的那一點不動；結果限制在 `bounds` 內。
 */
export function zoomAt(
  state: ViewerState,
  factor: number,
  point: ViewerPoint,
  bounds: ZoomBounds,
): ViewerState {
  const maxScale = Math.max(bounds.minScale, bounds.maxScale);
  const target = isPositive(factor) ? state.scale * factor : state.scale;
  // 去掉浮點誤差（0.4 × 1.5 × (1 / 1.5) 應該回到 0.4），「100%」與「符合視窗」才比得準
  const scale = Math.min(maxScale, Math.max(bounds.minScale, roundScale(target)));
  const ratio = state.scale > 0 ? scale / state.scale : 1;
  return clampOffset(
    {
      scale,
      x: point.x - (point.x - state.x) * ratio,
      y: point.y - (point.y - state.y) * ratio,
    },
    bounds.image,
    bounds.container,
  );
}

/**
 * 顯示 `displayedWidth`（CSS 像素）時需要的最小解析度：第一個寬度 ≥ `displayedWidth × dpr` 的 level 的索引；
 * 都不夠大時回傳最大的那個。`levels` 由小到大排序；空陣列回傳 -1。
 */
export function pickLevel(
  levels: readonly ViewerLevelSize[],
  displayedWidth: number,
  dpr: number,
): number {
  if (levels.length === 0) return -1;
  const needed = displayedWidth * (isPositive(dpr) ? dpr : 1);
  const index = levels.findIndex((level) => level.width >= needed);
  return index === -1 ? levels.length - 1 : index;
}
