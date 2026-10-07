import { describe, expect, it } from 'vitest';

import { collapsedRange } from '../breadcrumbLayout';

describe('collapsedRange（麵包屑放不下時收合哪幾層）', () => {
  it.each([
    { case: '全部放得下', widths: [80, 80, 80, 80], available: 320, expected: undefined },
    { case: '只有兩層，沒有中間可收', widths: [80, 200], available: 100, expected: undefined },
    {
      case: '放不下：保留根目錄與目前位置，往上補到放不下為止',
      widths: [100, 100, 100, 100, 100],
      available: 420,
      expected: { start: 1, end: 3 },
    },
    {
      case: '連上一層都放不下：只剩根目錄、「…」、目前位置',
      widths: [100, 100, 100, 100],
      available: 250,
      expected: { start: 1, end: 3 },
    },
    {
      case: '至少收一層：除了第一層之外都放得下時仍收起第一層',
      widths: [100, 100, 100, 100],
      available: 399,
      expected: { start: 1, end: 2 },
    },
  ])('$case', ({ widths, available, expected }) => {
    expect(collapsedRange(widths, 40, available)).toEqual(expected);
  });
});
