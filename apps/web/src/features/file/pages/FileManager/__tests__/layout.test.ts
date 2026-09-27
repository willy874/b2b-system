import { describe, expect, it } from 'vitest';

import {
  computeFileLayout,
  hitTest,
  itemRect,
  listColumnsFor,
  moveIndex,
  rectFromPoints,
} from '../layout';

describe('computeFileLayout（RWD：由容器寬度決定排版）', () => {
  it('卡片模式：寬度越大欄數越多，窄螢幕至少兩欄', () => {
    expect(computeFileLayout('grid', 270, 10).columns).toBe(2);
    expect(computeFileLayout('grid', 360, 10).columns).toBe(3);
    expect(computeFileLayout('grid', 800, 10).columns).toBe(4);
    expect(computeFileLayout('grid', 1400, 10).columns).toBe(7);
  });

  it('卡片模式：列數＝項目數 / 欄數（無條件進位）', () => {
    const layout = computeFileLayout('grid', 800, 10);
    expect(layout.rowCount).toBe(3);
  });

  it('列表模式：一列一筆，窄螢幕隱藏次要欄位', () => {
    expect(computeFileLayout('list', 1000, 5)).toMatchObject({ columns: 1, rowCount: 5 });
    expect(listColumnsFor(400)).toEqual(['name', 'size']);
    expect(listColumnsFor(1000)).toEqual(['name', 'kind', 'size', 'createdAt', 'uploader']);
  });
});

describe('hitTest（框選命中，含畫面外的項目）', () => {
  const layout = computeFileLayout('grid', 800, 20); // 4 欄

  it('框住第一列前兩格', () => {
    const first = itemRect(layout, 0);
    const second = itemRect(layout, 1);
    const rect = rectFromPoints(
      { x: first.left + 5, y: first.top + 5 },
      { x: second.left + 5, y: second.top + 20 },
    );
    expect(hitTest(layout, rect, 20)).toEqual([0, 1]);
  });

  it('框在間距裡不命中任何項目', () => {
    const first = itemRect(layout, 0);
    const rect = { left: first.left + first.width + 1, top: first.top, width: 5, height: 5 };
    expect(hitTest(layout, rect, 20)).toEqual([]);
  });

  it('縱向跨列：每一列在框內的欄都命中；超過項目數的格子不算', () => {
    const rect = { left: 0, top: 0, width: 10_000, height: 100_000 };
    expect(hitTest(layout, rect, 6)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('列表模式：只看垂直方向', () => {
    const list = computeFileLayout('list', 600, 100);
    expect(hitTest(list, { left: 10, top: 50, width: 5, height: 100 }, 100)).toEqual([1, 2, 3]);
  });
});

describe('moveIndex（方向鍵）', () => {
  const layout = computeFileLayout('grid', 800, 10); // 4 欄

  it('左右一格、上下一列，到邊界停住', () => {
    expect(moveIndex(layout, 5, 'ArrowRight', 10)).toBe(6);
    expect(moveIndex(layout, 5, 'ArrowUp', 10)).toBe(1);
    expect(moveIndex(layout, 1, 'ArrowUp', 10)).toBe(1);
    expect(moveIndex(layout, 8, 'ArrowDown', 10)).toBe(8);
  });

  it('還沒有焦點時：往下從第一筆開始、往上從最後一筆開始', () => {
    expect(moveIndex(layout, -1, 'ArrowDown', 10)).toBe(0);
    expect(moveIndex(layout, -1, 'ArrowUp', 10)).toBe(9);
    expect(moveIndex(layout, 3, 'End', 10)).toBe(9);
    expect(moveIndex(layout, 3, 'Home', 10)).toBe(0);
  });
});
