import type { Column, ColumnPinningState, RowPinningState } from '@tanstack/react-table';
import { useLayoutEffect, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';

/** 預設固定在右側的欄位：操作欄在水平捲動時一律看得到。 */
export const DEFAULT_COLUMN_PINNING: ColumnPinningState = { right: ['actions'] };

export type RowPinSide = 'top' | 'bottom';

/**
 * 固定欄位與釘選列的 sticky 位移（px），由實際量到的欄寬、列高算出：
 * 欄寬交給瀏覽器分配，沒有宣告 `size` 的欄位也能正確地多欄固定。
 */
export interface PinLayout {
  columns: Record<string, { left?: number; right?: number }>;
  rows: Record<string, { top?: number; bottom?: number }>;
}

const EMPTY_LAYOUT: PinLayout = { columns: {}, rows: {} };

interface PinLayoutInput {
  columnPinning: ColumnPinningState;
  rowPinning: RowPinningState;
  /** 表頭也是 sticky 時，頂端的釘選列要從表頭下緣開始排。 */
  stickyHeader: boolean;
}

function measure(
  table: HTMLTableElement,
  { columnPinning, rowPinning, stickyHeader }: PinLayoutInput,
): PinLayout {
  const width = (id: string) =>
    table.querySelector(`thead th[data-column-id="${CSS.escape(id)}"]`)?.getBoundingClientRect()
      .width ?? 0;
  const height = (id: string) =>
    table.querySelector(`tbody tr[data-value="${CSS.escape(id)}"]`)?.getBoundingClientRect()
      .height ?? 0;

  const columns: PinLayout['columns'] = {};
  let left = 0;
  for (const id of columnPinning.left ?? []) {
    columns[id] = { left };
    left += width(id);
  }
  let right = 0;
  for (const id of (columnPinning.right ?? []).toReversed()) {
    columns[id] = { right };
    right += width(id);
  }

  const rows: PinLayout['rows'] = {};
  let top = stickyHeader ? (table.tHead?.getBoundingClientRect().height ?? 0) : 0;
  for (const id of rowPinning.top ?? []) {
    rows[id] = { top };
    top += height(id);
  }
  let bottom = 0;
  for (const id of (rowPinning.bottom ?? []).toReversed()) {
    rows[id] = { bottom };
    bottom += height(id);
  }
  return { columns, rows };
}

/**
 * 量測固定欄位與釘選列的位移；表格尺寸改變（欄寬重新分配、內容換行）時重新量。
 * 在 layout effect 裡量，第一次繪製前就已經是正確的位置。
 */
export function usePinLayout(
  tableRef: RefObject<HTMLTableElement | null>,
  input: PinLayoutInput,
  /** 會改變欄寬、列高的輸入（資料、欄位）；變了就重新量。 */
  deps: readonly unknown[],
): PinLayout {
  const [layout, setLayout] = useState(EMPTY_LAYOUT);
  const { columnPinning, rowPinning, stickyHeader } = input;

  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    const update = () => {
      const next = measure(table, { columnPinning, rowPinning, stickyHeader });
      setLayout((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(table);
    return () => observer.disconnect();
    // deps 由呼叫端提供
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [tableRef, columnPinning, rowPinning, stickyHeader, ...deps]);

  return layout;
}

export interface PinnedCellProps {
  style: CSSProperties | undefined;
  'data-pinned': 'left' | 'right' | undefined;
  /** 固定區與捲動區交界的那一欄，畫分隔線。 */
  'data-pinned-edge': true | undefined;
}

/** 固定欄位以 `position: sticky` 貼在捲動容器的左右緣，位移取自 `usePinLayout` 量到的欄寬。 */
export function getPinnedCellProps<TData>(
  column: Column<TData, unknown>,
  layout: PinLayout,
): PinnedCellProps {
  const side = column.getIsPinned();
  if (!side) return { style: undefined, 'data-pinned': undefined, 'data-pinned-edge': undefined };

  const edge = side === 'left' ? column.getIsLastColumn('left') : column.getIsFirstColumn('right');
  const offset = layout.columns[column.id];
  return {
    style: side === 'left' ? { left: offset?.left ?? 0 } : { right: offset?.right ?? 0 },
    'data-pinned': side,
    'data-pinned-edge': edge || undefined,
  };
}

export interface RowPin {
  side: RowPinSide;
  /** 釘選區與一般列交界的那一列（頂端的最後一列、底端的第一列），畫分隔線。 */
  edge: boolean;
  offset: number;
}
