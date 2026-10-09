/** 版面：`justified` 是等高排列（列高相同、寬度依比例填滿容器），`square` 是正方形方格。 */
export type GridLayoutMode = 'justified' | 'square';

/** 一個區段的輸入：寬高比（寬 ÷ 高）由資料提供，不必等圖片載入。 */
export interface GridSectionInput {
  key: string;
  items: readonly { key: string; aspectRatio: number }[];
}

/** 一個項目的位置與尺寸（像素，相對於整個內容的左上角）。 */
export interface GridItemRect {
  key: string;
  sectionIndex: number;
  /** 區段內的索引。 */
  index: number;
  /** 所有區段攤平後的索引。 */
  globalIndex: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 一個區段的位置：從標題的頂端開始，`height` 含標題。 */
export interface GridSectionRect {
  key: string;
  top: number;
  headerHeight: number;
  /** 含標題的高度。 */
  height: number;
  /** 第一個項目的 `globalIndex`。 */
  itemsStart: number;
  itemCount: number;
}

/** 一列：`start`／`end` 是 `globalIndex` 的範圍（`end` 不含）。 */
export interface GridRow {
  top: number;
  height: number;
  start: number;
  end: number;
}

export interface GridLayout {
  width: number;
  height: number;
  sections: GridSectionRect[];
  items: GridItemRect[];
  /** 由上到下排序；`hitTestGrid`、`visibleRange` 以它二分搜尋。 */
  rows: GridRow[];
}

export interface GridLayoutOptions {
  containerWidth: number;
  /** 目標列高；方格時是格子邊長的目標。 */
  rowHeight: number;
  gap: number;
  /** 區段標題的高度；0 表示不顯示標題。 */
  headerHeight: number;
  mode: GridLayoutMode;
  /**
   * 每個區段的最後一列放不滿時，列高最多拉到 `rowHeight × 這個值`。
   * 預設 1：最後一列維持目標列高、靠左，不拉伸。
   */
  maxRowHeightRatio?: number;
}

/** 某個區段的相對版面（`top` 相對於區段的頂端，含標題）。 */
interface SectionLayout {
  height: number;
  /** `globalIndex` 在這裡是區段內的索引，加上位移後才是全域的。 */
  items: Omit<GridItemRect, 'sectionIndex' | 'globalIndex'>[];
  rows: { top: number; height: number; start: number; end: number }[];
}

/** 已放到全域位置的區段；位移沒變時整份沿用，項目物件保持同一個參照。 */
interface PlacedSection {
  relative: SectionLayout;
  top: number;
  itemsStart: number;
  sectionIndex: number;
  rect: GridSectionRect;
  items: GridItemRect[];
  rows: GridRow[];
}

const POINT_EPSILON = 1e-6;

const EMPTY_LAYOUT: GridLayout = { width: 0, height: 0, sections: [], items: [], rows: [] };

/** 非法的寬高比（≤ 0、NaN、Infinity）當成 1。 */
function safeAspectRatio(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/**
 * 把一列的寬度四捨五入成整數像素：以「累計位置」取整，所以每一格的誤差不會累積；
 * `fill` 時最後一格補到剛好碰到容器右緣（寬度加總 ＋ 間距 ＝ 容器寬）。
 */
function placeRow(
  widths: readonly number[],
  gap: number,
  containerWidth: number,
  fill: boolean,
): { left: number; width: number }[] {
  const placed: { left: number; width: number }[] = [];
  let cursor = 0;
  widths.forEach((width, index) => {
    const left = Math.round(cursor);
    const isLast = index === widths.length - 1;
    const right = fill && isLast ? containerWidth : Math.round(cursor + width);
    placed.push({ left, width: Math.max(0, right - left) });
    cursor += width + gap;
  });
  return placed;
}

function layoutJustified(
  items: GridSectionInput['items'],
  options: GridLayoutOptions,
  startTop: number,
): SectionLayout {
  const { containerWidth, rowHeight, gap } = options;
  const maxLastRowHeight = rowHeight * (options.maxRowHeightRatio ?? 1);
  const result: SectionLayout = { height: 0, items: [], rows: [] };
  let top = startTop;
  let rowStart = 0;
  let ratioSum = 0;

  const flush = (end: number, isLast: boolean) => {
    const count = end - rowStart;
    const available = containerWidth - gap * (count - 1);
    const fullHeight = available / ratioSum;
    // 斷列的條件保證完整的列高 ≤ rowHeight；只有區段的最後一列可能放不滿
    const height = isLast && fullHeight > maxLastRowHeight ? maxLastRowHeight : fullHeight;
    const fill = height === fullHeight;
    const widths: number[] = [];
    for (let index = rowStart; index < end; index += 1) {
      widths.push(safeAspectRatio(items[index]?.aspectRatio ?? 1) * height);
    }
    const roundedHeight = Math.max(1, Math.round(height));
    placeRow(widths, gap, containerWidth, fill).forEach(({ left, width }, offset) => {
      const index = rowStart + offset;
      result.items.push({
        key: items[index]?.key ?? '',
        index,
        left,
        top,
        width,
        height: roundedHeight,
      });
    });
    result.rows.push({ top, height: roundedHeight, start: rowStart, end });
    top += roundedHeight + gap;
    rowStart = end;
    ratioSum = 0;
  };

  items.forEach((item, index) => {
    ratioSum += safeAspectRatio(item.aspectRatio);
    const count = index - rowStart + 1;
    const height = (containerWidth - gap * (count - 1)) / ratioSum;
    // 加進這一張之後列高已經不超過目標：在這裡斷列（極寬的圖會單獨一列、比目標矮）
    if (height <= rowHeight) flush(index + 1, false);
  });
  if (rowStart < items.length) flush(items.length, true);

  result.height = result.rows.length > 0 ? top - gap : startTop;
  return result;
}

function layoutSquare(
  items: GridSectionInput['items'],
  options: GridLayoutOptions,
  startTop: number,
): SectionLayout {
  const { containerWidth, rowHeight, gap } = options;
  const columns = Math.max(1, Math.floor((containerWidth + gap) / (rowHeight + gap)));
  const size = (containerWidth - gap * (columns - 1)) / columns;
  const cellHeight = Math.max(1, Math.round(size));
  const fullRow = placeRow(
    Array.from({ length: columns }, () => size),
    gap,
    containerWidth,
    true,
  );
  const result: SectionLayout = { height: 0, items: [], rows: [] };
  let top = startTop;
  for (let rowStart = 0; rowStart < items.length; rowStart += columns) {
    const end = Math.min(items.length, rowStart + columns);
    for (let index = rowStart; index < end; index += 1) {
      const cell = fullRow[index - rowStart] ?? { left: 0, width: 0 };
      result.items.push({
        key: items[index]?.key ?? '',
        index,
        left: cell.left,
        top,
        width: cell.width,
        height: cellHeight,
      });
    }
    result.rows.push({ top, height: cellHeight, start: rowStart, end });
    top += cellHeight + gap;
  }
  result.height = result.rows.length > 0 ? top - gap : startTop;
  return result;
}

function layoutSection(section: GridSectionInput, options: GridLayoutOptions): SectionLayout {
  const startTop = options.headerHeight;
  return options.mode === 'square'
    ? layoutSquare(section.items, options, startTop)
    : layoutJustified(section.items, options, startTop);
}

function sameOptions(a: GridLayoutOptions | undefined, b: GridLayoutOptions): boolean {
  return (
    !!a &&
    a.containerWidth === b.containerWidth &&
    a.rowHeight === b.rowHeight &&
    a.gap === b.gap &&
    a.headerHeight === b.headerHeight &&
    a.mode === b.mode &&
    (a.maxRowHeightRatio ?? 1) === (b.maxRowHeightRatio ?? 1)
  );
}

function placeSection(
  section: GridSectionInput,
  relative: SectionLayout,
  top: number,
  itemsStart: number,
  sectionIndex: number,
  headerHeight: number,
): PlacedSection {
  return {
    relative,
    top,
    itemsStart,
    sectionIndex,
    rect: {
      key: section.key,
      top,
      headerHeight,
      height: relative.height,
      itemsStart,
      itemCount: section.items.length,
    },
    items: relative.items.map((item) => ({
      ...item,
      top: item.top + top,
      sectionIndex,
      globalIndex: item.index + itemsStart,
    })),
    rows: relative.rows.map((row) => ({
      top: row.top + top,
      height: row.height,
      start: row.start + itemsStart,
      end: row.end + itemsStart,
    })),
  };
}

/** `createGridLayoutCache()` 的回傳值。 */
export interface GridLayoutCache {
  /**
   * 與 `computeGridLayout` 相同，但記住上一次的結果：
   * 同一個 `sections` 陣列與相同的選項直接回傳上一次的物件；
   * 區段的 key 與 `items` 參照沒變時沿用它的相對版面，位移也沒變時連 `GridItemRect` 物件都沿用。
   * 無限捲動時只有新載入的區段（或被補上項目的最後一個區段）會重算。
   */
  compute(sections: readonly GridSectionInput[], options: GridLayoutOptions): GridLayout;
}

/** 建立一個增量的版面快取（元件以 `useRef` 持有一個）。 */
export function createGridLayoutCache(): GridLayoutCache {
  let lastOptions: GridLayoutOptions | undefined;
  let lastSections: readonly GridSectionInput[] | undefined;
  let lastLayout: GridLayout | undefined;
  // key → 上一次的結果；選項改變時整份清掉
  let placed = new Map<string, { items: GridSectionInput['items']; placed: PlacedSection }>();

  return {
    compute(sections, options) {
      if (lastLayout && sections === lastSections && sameOptions(lastOptions, options)) {
        return lastLayout;
      }
      if (!sameOptions(lastOptions, options)) placed = new Map();
      lastOptions = { ...options };
      lastSections = sections;

      if (options.containerWidth <= 0 || options.rowHeight <= 0) {
        lastLayout = EMPTY_LAYOUT;
        return lastLayout;
      }

      const gap = Math.max(0, options.gap);
      const normalized: GridLayoutOptions = {
        ...options,
        gap,
        headerHeight: Math.max(0, options.headerHeight),
      };
      const next = new Map<string, { items: GridSectionInput['items']; placed: PlacedSection }>();
      const layout: GridLayout = {
        width: options.containerWidth,
        height: 0,
        sections: [],
        items: [],
        rows: [],
      };
      let top = 0;
      let itemsStart = 0;
      sections.forEach((section, sectionIndex) => {
        const cached = placed.get(section.key);
        let entry: PlacedSection;
        if (cached && cached.items === section.items) {
          entry =
            cached.placed.top === top &&
            cached.placed.itemsStart === itemsStart &&
            cached.placed.sectionIndex === sectionIndex
              ? cached.placed
              : placeSection(
                  section,
                  cached.placed.relative,
                  top,
                  itemsStart,
                  sectionIndex,
                  normalized.headerHeight,
                );
        } else {
          entry = placeSection(
            section,
            layoutSection(section, normalized),
            top,
            itemsStart,
            sectionIndex,
            normalized.headerHeight,
          );
        }
        next.set(section.key, { items: section.items, placed: entry });
        layout.sections.push(entry.rect);
        for (const item of entry.items) layout.items.push(item);
        for (const row of entry.rows) layout.rows.push(row);
        top += entry.rect.height + gap;
        itemsStart += section.items.length;
      });
      layout.height = sections.length > 0 ? top - gap : 0;
      placed = next;
      lastLayout = layout;
      return layout;
    },
  };
}

/**
 * 計算整個版面（docs/architecture/frontend/07-ui-system.md §3.19）：每個區段先放 `headerHeight` 的標題再放列，區段之間以 `gap` 分隔。
 * `containerWidth` ≤ 0（還沒量到寬度）時回傳空的版面。要增量計算用 `createGridLayoutCache()`。
 */
export function computeGridLayout(
  sections: readonly GridSectionInput[],
  options: GridLayoutOptions,
): GridLayout {
  return createGridLayoutCache().compute(sections, options);
}

/** 第一個底部超過 `top` 的列（二分搜尋）。 */
function firstRowEndingAfter(rows: readonly GridRow[], top: number): number {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const row = rows[middle] as GridRow;
    if (row.top + row.height <= top) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * 與矩形（內容座標）相交的項目 key，依版面順序。框選用：以列二分搜尋找到起點，只檢查垂直方向相交的列。
 */
export function hitTestGrid(
  layout: GridLayout,
  rect: { left: number; top: number; width: number; height: number },
): string[] {
  // 零寬或零高的矩形（點一下）當成極小的矩形，仍能命中它所在的項目
  const right = rect.left + Math.max(rect.width, POINT_EPSILON);
  const bottom = rect.top + Math.max(rect.height, POINT_EPSILON);
  const hits: string[] = [];
  for (
    let rowIndex = firstRowEndingAfter(layout.rows, rect.top);
    rowIndex < layout.rows.length;
    rowIndex += 1
  ) {
    const row = layout.rows[rowIndex] as GridRow;
    if (row.top >= bottom) break;
    for (let index = row.start; index < row.end; index += 1) {
      const item = layout.items[index];
      if (item && item.left < right && item.left + item.width > rect.left) hits.push(item.key);
    }
  }
  return hits;
}

/**
 * 與 `[top, bottom)` 垂直相交的項目範圍（`globalIndex`，`end` 不含）。
 * 範圍內沒有任何列（例如落在區段標題上）時回傳下一列起點的空範圍。
 */
export function visibleRange(
  layout: GridLayout,
  top: number,
  bottom: number,
): { start: number; end: number } {
  const first = firstRowEndingAfter(layout.rows, top);
  const firstRow = layout.rows[first];
  if (!firstRow) return { start: layout.items.length, end: layout.items.length };
  if (firstRow.top >= bottom) return { start: firstRow.start, end: firstRow.start };
  let last = first;
  while (last + 1 < layout.rows.length && (layout.rows[last + 1] as GridRow).top < bottom) {
    last += 1;
  }
  return { start: firstRow.start, end: (layout.rows[last] as GridRow).end };
}

/** 包含 `top` 的區段索引（最上方可見的區段）；沒有區段時回傳 -1。 */
export function sectionIndexAt(layout: GridLayout, top: number): number {
  let low = 0;
  let high = layout.sections.length - 1;
  let found = layout.sections.length > 0 ? 0 : -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((layout.sections[middle] as GridSectionRect).top <= top) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}
