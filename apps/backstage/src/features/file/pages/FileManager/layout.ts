import { intersects } from '@/core/selection';
import type { Rect } from '@/core/selection';

import type { FileViewMode } from '../../preference';

/**
 * 主區塊的版面（docs/architecture/frontend/12-file-manager.md §3）：由容器寬度算出欄數與每格位置。
 * 格子大小固定，所以任何一筆的位置都算得出來——虛擬捲動只渲染看得到的列，
 * 框選仍能以幾何計算命中 **畫面外** 的項目，不必依賴 DOM。
 */

/** 列表模式隨寬度顯示的欄位（窄螢幕只留檔名與大小）。 */
export type FileListColumn = 'name' | 'tags' | 'kind' | 'size' | 'uploader' | 'createdAt';

export interface FileLayout {
  mode: FileViewMode;
  /** 一列幾個項目（列表模式恆為 1）。 */
  columns: number;
  cellWidth: number;
  cellHeight: number;
  /** 項目之間的間距（列表模式為 0）。 */
  gap: number;
  /** 內容四周的留白。 */
  padding: number;
  /** 相鄰兩列的起點距離（`cellHeight + gap`）。 */
  rowStride: number;
  rowCount: number;
  /** 列表模式顯示的欄位。 */
  listColumns: readonly FileListColumn[];
}

const GRID_PADDING = 12;
const GRID_GAP = 12;
/** 卡片下方的檔名與資訊高度。 */
const GRID_CAPTION = 52;
const LIST_ROW_HEIGHT = 48;

/** 窄螢幕卡片小一點，手機寬度（含側欄收合後約 270 px 的內容區）一列至少兩張。 */
function minCardWidth(width: number): number {
  if (width < 400) return 100;
  return width < 520 ? 120 : 164;
}

export function listColumnsFor(width: number): FileListColumn[] {
  const columns: FileListColumn[] = ['name', 'size'];
  if (width >= 560) columns.splice(1, 0, 'kind');
  if (width >= 760) columns.push('createdAt');
  if (width >= 920) columns.push('uploader');
  // 標籤（docs/architecture/backend/18-tag.md §7）緊跟在檔名後面，寬度夠時才顯示
  if (width >= 1080) columns.splice(1, 0, 'tags');
  return columns;
}

export function computeFileLayout(mode: FileViewMode, width: number, count: number): FileLayout {
  const usable = Math.max(0, width);
  if (mode === 'list') {
    return {
      mode,
      columns: 1,
      cellWidth: usable,
      cellHeight: LIST_ROW_HEIGHT,
      gap: 0,
      padding: 0,
      rowStride: LIST_ROW_HEIGHT,
      rowCount: count,
      listColumns: listColumnsFor(usable),
    };
  }
  const inner = Math.max(0, usable - GRID_PADDING * 2);
  const columns = Math.max(1, Math.floor((inner + GRID_GAP) / (minCardWidth(usable) + GRID_GAP)));
  const cellWidth = Math.max(1, (inner - GRID_GAP * (columns - 1)) / columns);
  const cellHeight = Math.round(cellWidth * 0.75) + GRID_CAPTION;
  return {
    mode,
    columns,
    cellWidth,
    cellHeight,
    gap: GRID_GAP,
    padding: GRID_PADDING,
    rowStride: cellHeight + GRID_GAP,
    rowCount: Math.ceil(count / columns),
    listColumns: [],
  };
}

/** 內容座標（含捲動量）中的項目位置。 */
export function itemRect(layout: FileLayout, index: number): Rect {
  const row = Math.floor(index / layout.columns);
  const column = index % layout.columns;
  return {
    left: layout.padding + column * (layout.cellWidth + layout.gap),
    top: layout.padding + row * layout.rowStride,
    width: layout.cellWidth,
    height: layout.cellHeight,
  };
}

/**
 * 框選命中的項目索引（依序）。只檢查框涵蓋的那幾列：一萬筆的清單拖曳時也只算幾十格。
 */
export function hitTest(layout: FileLayout, rect: Rect, count: number): number[] {
  if (count === 0 || rect.width <= 0 || rect.height <= 0) return [];
  const firstRow = Math.max(0, Math.floor((rect.top - layout.padding) / layout.rowStride));
  const lastRow = Math.min(
    layout.rowCount - 1,
    Math.floor((rect.top + rect.height - layout.padding) / layout.rowStride),
  );
  const hits: number[] = [];
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = 0; column < layout.columns; column += 1) {
      const index = row * layout.columns + column;
      if (index >= count) break;
      if (intersects(itemRect(layout, index), rect)) hits.push(index);
    }
  }
  return hits;
}

/** 鍵盤方向鍵移動焦點：卡片模式上下移一整列，到邊界停住。 */
export function moveIndex(
  layout: FileLayout,
  index: number,
  key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End',
  count: number,
): number {
  if (count === 0) return -1;
  const step = {
    ArrowUp: -layout.columns,
    ArrowDown: layout.columns,
    ArrowLeft: layout.mode === 'grid' ? -1 : 0,
    ArrowRight: layout.mode === 'grid' ? 1 : 0,
    Home: -Infinity,
    End: Infinity,
  }[key];
  if (index < 0) return step < 0 ? count - 1 : 0;
  const next = index + step;
  if (!Number.isFinite(next)) return next < 0 ? 0 : count - 1;
  return next < 0 || next >= count ? index : next;
}

/**
 * 在第 `at` 個項目之前插入 `count` 格佔位（無限捲動被 `maxPages` 丟掉的頁，docs/architecture/frontend/12-file-manager.md §5）。
 * 版面以格的索引計算：丟頁時佔位多一頁、項目少一頁，抓回來時反過來，其他項目的格索引（位置）都不變。
 */
export function withPlaceholders<T>(
  items: readonly T[],
  at: number,
  count: number,
): ReadonlyArray<T | undefined> {
  if (count <= 0) return items;
  return [
    ...items.slice(0, at),
    ...Array.from({ length: count }, () => undefined),
    ...items.slice(at),
  ];
}

/** 這幾列（列的索引）有沒有碰到佔位的格 `[at, at + count)`。 */
export function rowsTouchRange(
  rowIndexes: readonly number[],
  columns: number,
  at: number,
  count: number,
): boolean {
  if (count <= 0) return false;
  return rowIndexes.some((row) => {
    const first = row * columns;
    return first < at + count && first + columns > at;
  });
}
