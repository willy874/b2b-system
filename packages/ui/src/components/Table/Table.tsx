import { cn } from '@b2b-system/web-shared/utils';
import { useTable } from '@tanstack/react-table';
import type {
  ColumnPinningState,
  Row,
  RowData,
  RowPinningState,
  RowSelectionState,
  Updater,
} from '@tanstack/react-table';
import { useMemo, useRef } from 'react';
import type { CSSProperties, ReactNode, Ref } from 'react';

import { Empty } from '../Empty';
import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';
import { TABLE_FEATURES } from './features';
import type { TableColumnDef, TableFeatureSet } from './features';
import { DEFAULT_COLUMN_PINNING, toColumnPinningState, usePinLayout } from './pinning';
import type { PinLayout, RowPin } from './pinning';
import type { TableSlot } from './slots';
import type { TableSorting } from './sorting';
import { TableHeader } from './TableHeader';
import { TableRow } from './TableRow';
import { TableSkeleton } from './TableSkeleton';

import styles from './Table.module.css';

export interface TableProps<TData extends RowData> extends SlotOverrides<TableSlot> {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLDivElement>;
  data: TData[];
  columns: Array<TableColumnDef<TData>>;
  getRowId?: (row: TData) => string;
  loading?: boolean;
  emptyTitle?: ReactNode;
  emptyDescription?: ReactNode;
  /** 已進入選取模式時，單擊列身切換選取；雙擊一律開詳情。 */
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: (selection: RowSelectionState) => void;
  onRowDoubleClick?: (row: TData) => void;
  /** 多欄排序，陣列順序即優先順序（表頭顯示 1、2、3…）。 */
  sorting?: readonly TableSorting[];
  /**
   * 提供時，除了 `enableSorting: false` 的欄位，其餘表頭都可點擊排序：
   * 每一欄循環「不排 → 升冪 → 降冪 → 不排」，回報點擊後完整的排序陣列。
   */
  onSortingChange?: (sorting: TableSorting[]) => void;
  /**
   * 固定在最後一欄表頭右側、與標題垂直置中的內容（例如篩選、欄位設定按鈕）。
   * 欄寬不夠時，該欄的標題被裁掉（overflow hidden），這裡的內容不縮。
   */
  headerTrailing?: ReactNode;
  /**
   * 水平捲動時固定在 start（左）／end（右）兩側的欄位 id。預設把 `actions`（操作欄）固定在 end；
   * 傳 `{}` 取消固定。表頭與列的欄位順序會變成「start 固定 → 其餘 → end 固定」。
   */
  columnPinning?: Partial<ColumnPinningState>;
  /** 垂直捲動時表頭留在上方（表格外框變成捲動框，見 `maxHeight`）。 */
  stickyHeader?: boolean;
  /**
   * 釘選的資料列 id：`top` 依序貼在頂端、`bottom` 依序貼在底端，捲動時都留在原位；需要 `getRowId`。
   * 列必須在 `data` 裡——伺服器分頁時由呼叫端把其他頁的釘選列併進 `data`（`RichTable` 已處理）。
   */
  rowPinning?: RowPinningState;
  /**
   * 固定表頭或有釘選列時，外框變成最高這個高度的捲動框（預設 `70vh`）——
   * 頁面本身捲動時 sticky 無效，因為外框為了水平捲動已經是捲動容器。
   */
  maxHeight?: CSSProperties['maxHeight'];
  /**
   * 填滿父層（flex 欄）的剩餘高度：外框 `flex: 1` 並固定是雙向捲動框，不套 `maxHeight`。
   * 列表頁用它把分頁列推到底部、資料多時在表格內捲動；父層要是有高度上限的 flex 欄（`min-height: 0`）。
   */
  fillHeight?: boolean;
  /**
   * 展開中的列 id（需要 `getRowId`）：該列正下方插入一列橫跨所有欄位，內容由 `renderExpandedRow` 提供。
   * 展開狀態由呼叫端管理，通常搭配操作欄裡的展開按鈕。
   */
  expandedRowIds?: readonly string[];
  renderExpandedRow?: (row: TData) => ReactNode;
  className?: string;
  'data-testid'?: string;
}

const EMPTY_SELECTION: RowSelectionState = {};
const EMPTY_SORTING: readonly TableSorting[] = [];
const EMPTY_ROW_PINNING: RowPinningState = { top: [], bottom: [] };
const EMPTY_EXPANDED: readonly string[] = [];
const DEFAULT_MAX_HEIGHT = '70vh';

/** TanStack 的 columnSizingFeature 會把預設寬度（150）併進每個 columnDef；清掉它，TableHeader 才分得出「沒宣告 size」。 */
const DEFAULT_COLUMN = { size: undefined };

/**
 * 資料表格：TanStack Table 負責欄位模型，排序、分頁都交給伺服器（只回報使用者的操作）。
 * 各層的實作拆在 `TableHeader`（排序）、`TableRow`（點擊與選取）、`TableSkeleton`（載入中）。
 */
export function Table<TData extends RowData>({
  data,
  columns,
  getRowId,
  loading,
  emptyTitle = '沒有資料',
  emptyDescription,
  rowSelection = EMPTY_SELECTION,
  onRowSelectionChange,
  onRowDoubleClick,
  sorting = EMPTY_SORTING,
  onSortingChange,
  headerTrailing,
  columnPinning = DEFAULT_COLUMN_PINNING,
  stickyHeader,
  maxHeight = DEFAULT_MAX_HEIGHT,
  fillHeight,
  rowPinning = EMPTY_ROW_PINNING,
  expandedRowIds = EMPTY_EXPANDED,
  renderExpandedRow,
  className,
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: TableProps<TData>) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  const tableRef = useRef<HTMLTableElement>(null);
  const pinningState = useMemo(() => toColumnPinningState(columnPinning), [columnPinning]);
  const table = useTable({
    features: TABLE_FEATURES,
    data,
    columns,
    defaultColumn: DEFAULT_COLUMN,
    getRowId,
    state: { rowSelection, columnPinning: pinningState, rowPinning },
    keepPinnedRows: true,
    enableRowSelection: Boolean(onRowSelectionChange),
    onRowSelectionChange: (updater: Updater<RowSelectionState>) => {
      onRowSelectionChange?.(typeof updater === 'function' ? updater(rowSelection) : updater);
    },
    manualSorting: true,
  });

  const hasPinnedRows = Boolean(rowPinning.top?.length || rowPinning.bottom?.length);
  const scrollable = Boolean(stickyHeader) || hasPinnedRows;
  const pinLayout = usePinLayout(
    tableRef,
    { columnPinning: pinningState, rowPinning, stickyHeader: Boolean(stickyHeader) },
    [data, columns, loading],
  );

  const expandedContent = (row: Row<TableFeatureSet, TData>): ReactNode =>
    renderExpandedRow && expandedRowIds.includes(row.id)
      ? renderExpandedRow(row.original)
      : undefined;

  // 尚未勾選任何一列時，單擊列身不做任何事
  const selectable = Boolean(onRowSelectionChange) && Object.values(rowSelection).some(Boolean);

  return (
    <div
      className={cn(styles.root, className)}
      data-scrollable={scrollable || fillHeight || undefined}
      data-fill-height={fillHeight || undefined}
      data-sticky-header={stickyHeader || undefined}
      data-expandable={renderExpandedRow ? true : undefined}
      style={scrollable && !fillHeight ? { maxHeight } : undefined}
      {...rest}
    >
      <table ref={tableRef} {...slot('table', styles.table)} aria-busy={loading || undefined}>
        <TableHeader
          headerGroups={table.getHeaderGroups()}
          pinLayout={pinLayout}
          sorting={sorting}
          onSortingChange={onSortingChange}
          trailing={headerTrailing}
          slot={slot}
        />
        <tbody {...slot('body')}>
          {loading ? (
            <TableSkeleton columnCount={table.getAllLeafColumns().length} slot={slot} />
          ) : (
            <>
              {table.getTopRows().map((row, index, pinned) => (
                <TableRow
                  key={row.id}
                  row={row}
                  pin={rowPin(pinLayout, row.id, 'top', index === pinned.length - 1)}
                  pinLayout={pinLayout}
                  expandedContent={expandedContent(row)}
                  selectable={selectable}
                  onDoubleClick={onRowDoubleClick}
                  slot={slot}
                />
              ))}
              {table.getCenterRows().map((row) => (
                <TableRow
                  key={row.id}
                  row={row}
                  pinLayout={pinLayout}
                  expandedContent={expandedContent(row)}
                  selectable={selectable}
                  onDoubleClick={onRowDoubleClick}
                  slot={slot}
                />
              ))}
              {table.getBottomRows().map((row, index) => (
                <TableRow
                  key={row.id}
                  row={row}
                  pin={rowPin(pinLayout, row.id, 'bottom', index === 0)}
                  pinLayout={pinLayout}
                  expandedContent={expandedContent(row)}
                  selectable={selectable}
                  onDoubleClick={onRowDoubleClick}
                  slot={slot}
                />
              ))}
            </>
          )}
        </tbody>
      </table>

      {!loading && data.length === 0 && (
        <Empty
          title={emptyTitle}
          description={emptyDescription}
          {...slot('empty', undefined, { testId: 'table-empty' })}
        />
      )}
    </div>
  );
}

function rowPin(layout: PinLayout, id: string, side: RowPin['side'], edge: boolean): RowPin {
  return { side, edge, offset: layout.rows[id]?.[side] ?? 0 };
}
