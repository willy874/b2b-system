/** 內容座標（含捲動量）中的矩形。 */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** 指標靠近上下邊緣多少 px 時自動捲動。 */
export const EDGE_SCROLL_ZONE = 48;
/** 自動捲動每幀最多幾 px（越靠近邊緣越快）。 */
export const EDGE_SCROLL_MAX_SPEED = 24;

/** 兩點圍出的矩形（拖曳方向不限）。 */
export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/** 兩個矩形有沒有重疊（只碰到邊不算）。 */
export function intersects(a: Rect, b: Rect): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

/**
 * 拖曳到捲動容器的上下邊緣時，這一幀要捲動多少 px（負數往上）：在邊緣 `EDGE_SCROLL_ZONE` px 內才捲，
 * 越靠近（或超出）邊緣越快，最多 `EDGE_SCROLL_MAX_SPEED`；不在邊緣時回 0。
 *
 * @param pointerY 指標的 viewport 座標
 * @param bounds 捲動容器的 viewport 範圍（`getBoundingClientRect()`）
 */
export function edgeScrollDelta(pointerY: number, bounds: { top: number; bottom: number }): number {
  const distanceTop = pointerY - bounds.top;
  const distanceBottom = bounds.bottom - pointerY;
  if (distanceTop < EDGE_SCROLL_ZONE) {
    return -EDGE_SCROLL_MAX_SPEED * (1 - Math.max(0, distanceTop) / EDGE_SCROLL_ZONE);
  }
  if (distanceBottom < EDGE_SCROLL_ZONE) {
    return EDGE_SCROLL_MAX_SPEED * (1 - Math.max(0, distanceBottom) / EDGE_SCROLL_ZONE);
  }
  return 0;
}
