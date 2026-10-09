import { describe, expect, it } from 'vitest';

import {
  computeGridLayout,
  createGridLayoutCache,
  hitTestGrid,
  sectionIndexAt,
  visibleRange,
} from './layout';
import type { GridLayout, GridLayoutOptions, GridSectionInput } from './layout';

const BASE: GridLayoutOptions = {
  containerWidth: 1000,
  rowHeight: 200,
  gap: 0,
  headerHeight: 0,
  mode: 'justified',
};

function section(key: string, ratios: readonly number[]): GridSectionInput {
  return {
    key,
    items: ratios.map((aspectRatio, index) => ({ key: `${key}-${index}`, aspectRatio })),
  };
}

/** 每一列的寬度加總（含間距）：最後一格的右緣。 */
function rowWidths(layout: GridLayout): number[] {
  return layout.rows.map((row) => {
    const last = layout.items[row.end - 1];
    return last ? last.left + last.width : 0;
  });
}

describe('computeGridLayout：justified', () => {
  it.each([
    {
      name: '五張正方形剛好填滿第一列，第六張放到最後一列',
      ratios: [1, 1, 1, 1, 1, 1],
      gap: 0,
      rows: [
        { height: 200, count: 5 },
        { height: 200, count: 1 },
      ],
    },
    {
      name: '極寬的圖單獨一列，比目標列高矮',
      ratios: [10],
      gap: 0,
      rows: [{ height: 100, count: 1 }],
    },
    {
      name: '極寬的圖接在一般的圖之後：加進它時斷列',
      ratios: [1, 10, 1],
      gap: 0,
      rows: [
        { height: 91, count: 2 },
        { height: 200, count: 1 },
      ],
    },
    {
      name: '非法的寬高比（0、負數、NaN）當成 1',
      ratios: [0, -2, Number.NaN, 1, 1],
      gap: 0,
      rows: [{ height: 200, count: 5 }],
    },
    {
      name: '有間距時列高以扣掉間距後的寬度計算',
      ratios: [1, 1, 1, 1, 1],
      gap: 10,
      rows: [{ height: 192, count: 5 }],
    },
  ])('$name', ({ ratios, gap, rows }) => {
    const layout = computeGridLayout([section('s', ratios)], { ...BASE, gap });
    expect(layout.rows.map((row) => ({ height: row.height, count: row.end - row.start }))).toEqual(
      rows,
    );
  });

  it.each([
    { ratios: [1.3, 0.7, 1.5, 0.9, 1.1, 1.7, 2.3, 0.6], width: 997, gap: 3 },
    { ratios: [0.75, 0.75, 1.333, 1.5, 1, 0.5625], width: 1201, gap: 4 },
    { ratios: [16 / 9, 4 / 3, 3 / 2, 1, 2 / 3], width: 640, gap: 0 },
  ])('放滿的列寬度加總（含間距）剛好等於容器寬：$width px／gap $gap', ({ ratios, width, gap }) => {
    const repeated = [...ratios, ...ratios, ...ratios];
    const layout = computeGridLayout([section('s', repeated)], {
      ...BASE,
      containerWidth: width,
      rowHeight: 160,
      gap,
    });
    const full = rowWidths(layout).slice(0, -1);
    expect(full.length).toBeGreaterThan(0);
    for (const total of full) expect(total).toBe(width);
    for (const row of layout.rows.slice(0, -1)) expect(row.height).toBeLessThanOrEqual(160);
    // 同一列的項目高度相同、彼此以 gap 相隔
    for (const row of layout.rows) {
      const items = layout.items.slice(row.start, row.end);
      items.forEach((item, index) => {
        expect(item.height).toBe(row.height);
        const previous = items[index - 1];
        if (previous) expect(item.left - (previous.left + previous.width)).toBe(gap);
      });
    }
  });

  it('最後一列預設不拉伸：維持目標列高、靠左', () => {
    const layout = computeGridLayout([section('s', [1, 1, 1, 1, 1, 1, 2])], BASE);
    const lastRow = layout.rows.at(-1);
    expect(lastRow?.height).toBe(200);
    const last = layout.items.slice(lastRow?.start, lastRow?.end);
    expect(last.map(({ left, width }) => ({ left, width }))).toEqual([
      { left: 0, width: 200 },
      { left: 200, width: 400 },
    ]);
  });

  it('maxRowHeightRatio：最後一列放得下時拉伸填滿，超過上限時停在上限', () => {
    const filled = computeGridLayout([section('s', [1, 1, 1, 1, 1, 1.5, 2])], {
      ...BASE,
      maxRowHeightRatio: 2,
    });
    expect(filled.rows.at(-1)?.height).toBe(286);
    expect(rowWidths(filled).at(-1)).toBe(1000);

    const capped = computeGridLayout([section('s', [1, 1, 1, 1, 1, 1])], {
      ...BASE,
      maxRowHeightRatio: 1.5,
    });
    expect(capped.rows.at(-1)?.height).toBe(300);
    expect(capped.items.at(-1)).toMatchObject({ left: 0, width: 300 });
  });

  it('列的 top 依序累加列高與間距', () => {
    const layout = computeGridLayout([section('s', [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1])], {
      ...BASE,
      gap: 10,
    });
    expect(layout.rows.map((row) => row.top)).toEqual([0, 202, 404]);
    expect(layout.height).toBe(404 + 200);
  });

  it('還沒量到寬度時回傳空的版面', () => {
    expect(computeGridLayout([section('s', [1])], { ...BASE, containerWidth: 0 })).toMatchObject({
      height: 0,
      items: [],
      rows: [],
    });
  });
});

describe('computeGridLayout：square', () => {
  it.each([
    { width: 1000, rowHeight: 180, gap: 4, columns: 5, size: 197 },
    { width: 1000, rowHeight: 200, gap: 0, columns: 5, size: 200 },
    { width: 375, rowHeight: 120, gap: 2, columns: 3, size: 124 },
    { width: 100, rowHeight: 180, gap: 4, columns: 1, size: 100 },
  ])('$width px、目標 $rowHeight、gap $gap → 每列 $columns 格', (input) => {
    const layout = computeGridLayout(
      [
        section(
          's',
          Array.from({ length: 12 }, () => 1.5),
        ),
      ],
      {
        ...BASE,
        mode: 'square',
        containerWidth: input.width,
        rowHeight: input.rowHeight,
        gap: input.gap,
      },
    );
    const first = layout.rows[0];
    expect(first ? first.end - first.start : 0).toBe(input.columns);
    expect(first?.height).toBe(input.size);
    // 寬高比不影響方格；每一列（含不滿的最後一列）的格子都對齊同樣的欄
    expect(rowWidths(layout)[0]).toBe(input.width);
    const lastRow = layout.rows.at(-1);
    expect(layout.items[lastRow?.start ?? 0]?.left).toBe(0);
  });
});

describe('computeGridLayout：區段', () => {
  it('每個區段先放標題再放列，區段之間以 gap 分隔；globalIndex 跨區段連續', () => {
    const layout = computeGridLayout(
      [section('a', [1, 1, 1, 1, 1]), section('b', []), section('c', [1, 1])],
      { ...BASE, gap: 0, headerHeight: 40 },
    );
    expect(layout.sections).toEqual([
      { key: 'a', top: 0, headerHeight: 40, height: 240, itemsStart: 0, itemCount: 5 },
      { key: 'b', top: 240, headerHeight: 40, height: 40, itemsStart: 5, itemCount: 0 },
      { key: 'c', top: 280, headerHeight: 40, height: 240, itemsStart: 5, itemCount: 2 },
    ]);
    expect(layout.items[5]).toMatchObject({
      key: 'c-0',
      sectionIndex: 2,
      index: 0,
      globalIndex: 5,
      top: 320,
    });
    expect(layout.height).toBe(520);

    const spaced = computeGridLayout([section('a', [1, 1, 1, 1, 1]), section('c', [1])], {
      ...BASE,
      gap: 8,
      headerHeight: 40,
    });
    const [, second] = spaced.sections;
    const firstSection = spaced.sections[0];
    expect(second?.top).toBe((firstSection?.height ?? 0) + 8);
  });
});

describe('hitTestGrid 與 visibleRange', () => {
  // 兩個區段、標題 40：a 是 5 張一列（top 40～240），b 從 240 開始，標題後是 5 張與 1 張兩列
  const layout = computeGridLayout(
    [section('a', [1, 1, 1, 1, 1]), section('b', [1, 1, 1, 1, 1, 1])],
    { ...BASE, headerHeight: 40 },
  );

  it.each([
    { name: '點在單一項目上', rect: { left: 210, top: 50, width: 0, height: 0 }, hits: ['a-1'] },
    {
      name: '跨兩個區段的框選',
      rect: { left: 350, top: 200, width: 100, height: 150 },
      hits: ['a-1', 'a-2', 'b-1', 'b-2'],
    },
    { name: '只框到標題', rect: { left: 0, top: 245, width: 1000, height: 20 }, hits: [] },
    {
      name: '框到最後一列不滿的空白',
      rect: { left: 300, top: 500, width: 200, height: 50 },
      hits: [],
    },
    { name: '版面之外', rect: { left: 0, top: 2000, width: 100, height: 100 }, hits: [] },
  ])('hitTestGrid：$name', ({ rect, hits }) => {
    expect(hitTestGrid(layout, rect)).toEqual(hits);
  });

  it.each([
    { name: '第一列', top: 0, bottom: 100, range: { start: 0, end: 5 } },
    { name: '跨區段', top: 100, bottom: 300, range: { start: 0, end: 10 } },
    { name: '只在標題上', top: 241, bottom: 279, range: { start: 5, end: 5 } },
    { name: '到底', top: 500, bottom: 9999, range: { start: 10, end: 11 } },
    { name: '超出內容', top: 9000, bottom: 9999, range: { start: 11, end: 11 } },
  ])('visibleRange：$name', ({ top, bottom, range }) => {
    expect(visibleRange(layout, top, bottom)).toEqual(range);
  });

  it('sectionIndexAt：包含該位置的區段', () => {
    expect(sectionIndexAt(layout, 0)).toBe(0);
    expect(sectionIndexAt(layout, 239)).toBe(0);
    expect(sectionIndexAt(layout, 240)).toBe(1);
    expect(sectionIndexAt(layout, 9999)).toBe(1);
    expect(sectionIndexAt(computeGridLayout([], BASE), 0)).toBe(-1);
  });
});

describe('createGridLayoutCache', () => {
  it('同一個輸入回傳同一個物件', () => {
    const cache = createGridLayoutCache();
    const sections = [section('a', [1, 1])];
    expect(cache.compute(sections, BASE)).toBe(cache.compute(sections, { ...BASE }));
  });

  it('附加新區段：前面的區段沿用同一批項目物件，只算新的', () => {
    const cache = createGridLayoutCache();
    const a = section('a', [1, 1, 1, 1, 1, 1]);
    const first = cache.compute([a], BASE);
    const b = section('b', [1, 2]);
    const second = cache.compute([a, b], BASE);
    expect(second).not.toBe(first);
    expect(second.items[0]).toBe(first.items[0]);
    expect(second.sections[0]).toBe(first.sections[0]);
    expect(second.items.slice(0, 6)).toEqual(first.items);
    expect(second).toEqual(computeGridLayout([a, b], BASE));
  });

  it('最後一個區段補上項目：只有它重算，結果與重新計算相同', () => {
    const cache = createGridLayoutCache();
    const a = section('a', [1, 1, 1, 1, 1]);
    const b = section('b', [1]);
    const first = cache.compute([a, b], BASE);
    const grown = section('b', [1, 1, 1]);
    const second = cache.compute([a, grown], BASE);
    expect(second.items[0]).toBe(first.items[0]);
    expect(second.items[5]).not.toBe(first.items[5]);
    expect(second).toEqual(computeGridLayout([a, grown], BASE));
  });

  it('前面插入區段：沿用相對版面但重新定位', () => {
    const cache = createGridLayoutCache();
    const b = section('b', [1, 1]);
    cache.compute([b], BASE);
    const a = section('a', [1, 1, 1, 1, 1]);
    const result = cache.compute([a, b], BASE);
    expect(result).toEqual(computeGridLayout([a, b], BASE));
    expect(result.items[5]).toMatchObject({ key: 'b-0', globalIndex: 5, sectionIndex: 1 });
  });

  it('選項改變時全部重算', () => {
    const cache = createGridLayoutCache();
    const sections = [section('a', [1, 1, 1])];
    const first = cache.compute(sections, BASE);
    const second = cache.compute(sections, { ...BASE, containerWidth: 600 });
    expect(second.items[0]).not.toBe(first.items[0]);
    expect(second).toEqual(computeGridLayout(sections, { ...BASE, containerWidth: 600 }));
  });
});
