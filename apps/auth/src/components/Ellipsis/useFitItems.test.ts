import { describe, expect, it } from 'vitest';

import { fitIndices } from './useFitItems';

describe('fitIndices（可見項目的計算）', () => {
  // 四個項目各 50px、間距 10px、溢出區 30px
  const widths = [50, 50, 50, 50];

  it.each([
    { available: 230, pinned: undefined, expected: [0, 1, 2, 3], note: '全部放得下' },
    { available: 150, pinned: undefined, expected: [0, 1], note: '放不下時預留溢出區寬度' },
    { available: 150, pinned: 0, expected: [0, 1], note: '釘住的項目本來就看得到' },
    { available: 150, pinned: 3, expected: [0, 3], note: '釘住的項目佔最後一個可見位置' },
    { available: 150, pinned: 1, expected: [0, 1], note: '釘住的項目在前段時順序不變' },
    { available: 80, pinned: 2, expected: [2], note: '只放得下釘住的項目' },
    { available: 20, pinned: 2, expected: [2], note: '連釘住的都放不下時仍顯示它' },
    { available: 150, pinned: 9, expected: [0, 1], note: '超出範圍的 pinned 忽略' },
  ])('$note', ({ available, pinned, expected }) => {
    expect(fitIndices(widths, 30, 10, available, { pinned })).toEqual(expected);
  });

  it('受 limit 限制時，釘住的項目算在數量內', () => {
    expect(fitIndices(widths, 30, 10, 1000, { limit: 2, pinned: 3 })).toEqual([0, 3]);
  });

  it('寬度 0 的項目（display: none）不佔位置也不多算間距', () => {
    // 50 + 10 + 50 + 10 + 50 ＝ 170
    expect(fitIndices([50, 0, 50, 0, 50], 30, 10, 170)).toEqual([0, 1, 2, 3, 4]);
  });
});
