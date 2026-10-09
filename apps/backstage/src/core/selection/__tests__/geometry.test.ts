import { describe, expect, it } from 'vitest';

import {
  EDGE_SCROLL_MAX_SPEED,
  EDGE_SCROLL_ZONE,
  edgeScrollDelta,
  intersects,
  rectFromPoints,
} from '../geometry';

describe('rectFromPoints（兩點圍出的矩形）', () => {
  it.each([
    ['往右下拖', { x: 10, y: 20 }, { x: 40, y: 70 }],
    ['往左上拖', { x: 40, y: 70 }, { x: 10, y: 20 }],
  ])('%s：起點取兩點較小的座標、寬高取絕對值', (_label, a, b) => {
    expect(rectFromPoints(a, b)).toEqual({ left: 10, top: 20, width: 30, height: 50 });
  });

  it('同一點 → 寬高為 0', () => {
    expect(rectFromPoints({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({
      left: 5,
      top: 5,
      width: 0,
      height: 0,
    });
  });
});

describe('intersects（矩形重疊）', () => {
  const box = { left: 10, top: 10, width: 20, height: 20 };

  it.each([
    ['部分重疊', { left: 25, top: 25, width: 10, height: 10 }, true],
    ['完全包住', { left: 0, top: 0, width: 100, height: 100 }, true],
    ['在裡面', { left: 15, top: 15, width: 1, height: 1 }, true],
    ['只碰到右邊', { left: 30, top: 10, width: 5, height: 5 }, false],
    ['只碰到下邊', { left: 10, top: 30, width: 5, height: 5 }, false],
    ['完全分開', { left: 50, top: 50, width: 5, height: 5 }, false],
  ])('%s → %s', (_label, other, expected) => {
    expect(intersects(box, other)).toBe(expected);
    expect(intersects(other, box)).toBe(expected);
  });
});

describe('edgeScrollDelta（拖到邊緣的自動捲動）', () => {
  const bounds = { top: 0, bottom: 300 };

  it('在中間不捲動', () => {
    expect(edgeScrollDelta(150, bounds)).toBe(0);
    expect(edgeScrollDelta(EDGE_SCROLL_ZONE, bounds)).toBe(0);
    expect(edgeScrollDelta(300 - EDGE_SCROLL_ZONE, bounds)).toBe(0);
  });

  it('靠近下緣往下捲，越近越快：距下緣 10 px → 24 × (1 − 10 / 48)', () => {
    expect(edgeScrollDelta(290, bounds)).toBeCloseTo(24 * (1 - 10 / 48));
    expect(edgeScrollDelta(299, bounds)).toBeGreaterThan(edgeScrollDelta(290, bounds));
  });

  it('靠近上緣往上捲（負數）', () => {
    expect(edgeScrollDelta(0, bounds)).toBe(-EDGE_SCROLL_MAX_SPEED);
    expect(edgeScrollDelta(24, bounds)).toBeCloseTo(-12);
  });

  it('超出容器時以最快速度捲動，不會更快', () => {
    expect(edgeScrollDelta(-100, bounds)).toBe(-EDGE_SCROLL_MAX_SPEED);
    expect(edgeScrollDelta(400, bounds)).toBe(EDGE_SCROLL_MAX_SPEED);
  });
});
