import { describe, expect, it } from 'vitest';

import { clampOffset, fitScale, fitState, pickLevel, zoomAt } from './zoom';
import type { ZoomBounds } from './zoom';

const WIDE = { width: 2000, height: 1000 };
const VIEWPORT = { width: 800, height: 600 };

describe('fitScale', () => {
  it.each([
    { name: '寬圖：以寬度為準', image: WIDE, container: VIEWPORT, scale: 0.4 },
    {
      name: '直式圖：以高度為準',
      image: { width: 1000, height: 4000 },
      container: VIEWPORT,
      scale: 0.15,
    },
    {
      name: '小圖：不放大超過 100%',
      image: { width: 400, height: 300 },
      container: VIEWPORT,
      scale: 1,
    },
    { name: '剛好一樣大', image: VIEWPORT, container: VIEWPORT, scale: 1 },
    { name: '還沒量到容器', image: WIDE, container: { width: 0, height: 0 }, scale: 1 },
    {
      name: '圖片尺寸不合法',
      image: { width: Number.NaN, height: 10 },
      container: VIEWPORT,
      scale: 1,
    },
  ])('$name', ({ image, container, scale }) => {
    expect(fitScale(image, container)).toBeCloseTo(scale);
  });
});

describe('clampOffset', () => {
  it.each([
    {
      name: '比容器小的軸置中',
      state: { scale: 0.4, x: 50, y: 0 },
      expected: { scale: 0.4, x: 0, y: 100 },
    },
    {
      name: '放大後不露出左上的空白',
      state: { scale: 1, x: 100, y: 50 },
      expected: { scale: 1, x: 0, y: 0 },
    },
    {
      name: '放大後不露出右下的空白',
      state: { scale: 1, x: -5000, y: -1000 },
      expected: { scale: 1, x: -1200, y: -400 },
    },
    {
      name: '範圍內不變',
      state: { scale: 1, x: -300, y: -200 },
      expected: { scale: 1, x: -300, y: -200 },
    },
  ])('$name', ({ state, expected }) => {
    expect(clampOffset(state, WIDE, VIEWPORT)).toEqual(expected);
  });

  it('fitState：符合視窗且置中', () => {
    expect(fitState(WIDE, VIEWPORT)).toEqual({ scale: 0.4, x: 0, y: 100 });
    expect(fitState({ width: 400, height: 300 }, VIEWPORT)).toEqual({ scale: 1, x: 200, y: 150 });
  });
});

describe('zoomAt', () => {
  const bounds: ZoomBounds = { image: WIDE, container: VIEWPORT, minScale: 0.4, maxScale: 4 };
  const fit = { scale: 0.4, x: 0, y: 100 };

  it.each([
    {
      name: '以游標為中心放大到 100%',
      factor: 2.5,
      point: { x: 400, y: 300 },
      expected: { scale: 1, x: -600, y: -200 },
    },
    {
      name: '以圖片的左上角為中心放大：上方不露出空白',
      factor: 2.5,
      point: { x: 0, y: 100 },
      expected: { scale: 1, x: 0, y: 0 },
    },
    {
      name: '不超過最大縮放',
      factor: 100,
      point: { x: 400, y: 300 },
      expected: { scale: 4, x: -3600, y: -1700 },
    },
    {
      name: '不小於最小縮放（回到置中）',
      factor: 0.01,
      point: { x: 100, y: 100 },
      expected: fit,
    },
    { name: '不合法的倍數不變', factor: Number.NaN, point: { x: 0, y: 0 }, expected: fit },
  ])('$name', ({ factor, point, expected }) => {
    const next = zoomAt(fit, factor, point, bounds);
    expect(next.scale).toBeCloseTo(expected.scale);
    expect(next.x).toBeCloseTo(expected.x);
    expect(next.y).toBeCloseTo(expected.y);
  });

  it('游標下的那一點在縮放前後不動（範圍內時）', () => {
    const start = { scale: 1, x: -600, y: -200 };
    const point = { x: 250, y: 120 };
    const before = { x: (point.x - start.x) / start.scale, y: (point.y - start.y) / start.scale };
    const next = zoomAt(start, 1.7, point, bounds);
    expect((point.x - next.x) / next.scale).toBeCloseTo(before.x);
    expect((point.y - next.y) / next.scale).toBeCloseTo(before.y);
  });
});

describe('pickLevel', () => {
  const levels = [{ width: 800 }, { width: 1600 }, { width: 4000 }];

  it.each([
    { displayed: 400, dpr: 1, index: 0 },
    { displayed: 800, dpr: 1, index: 0 },
    { displayed: 800, dpr: 2, index: 1 },
    { displayed: 1200, dpr: 1, index: 1 },
    { displayed: 3000, dpr: 1, index: 2 },
    { displayed: 10_000, dpr: 1, index: 2 },
    { displayed: 900, dpr: 0, index: 1 },
  ])('顯示 $displayed px × dpr $dpr → 第 $index 個', ({ displayed, dpr, index }) => {
    expect(pickLevel(levels, displayed, dpr)).toBe(index);
  });

  it('沒有任何 level 時回傳 -1', () => {
    expect(pickLevel([], 100, 1)).toBe(-1);
  });
});
