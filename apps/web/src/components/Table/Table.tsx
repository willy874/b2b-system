import { getCoreRowModel, useReactTable } from '@tanstack/react-table';
import type { ColumnDef, RowSelectionState, Updater } from '@tanstack/react-table';
import type { ReactNode, Ref } from 'react';

import { cn } from '@/shared/utils';

import { Empty } from '../Empty';
import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';
import type { TableSlot } from './slots';
import type { TableSorting } from './sorting';
import { TableHeader } from './TableHeader';
import { TableRow } from './TableRow';
import { TableSkeleton } from './TableSkeleton';

import styles from './Table.module.css';

export interface TableProps<TData> extends SlotOverrides<TableSlot> {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLDivElement>;
  data: TData[];
  columns: Array<ColumnDef<TData, unknown>>;
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
   * 固定在最後一欄表頭右側、靠底的內容（例如篩選、欄位設定按鈕）。
   * 欄寬不夠時，該欄的標題被裁掉（overflow hidden），這裡的內容不縮。
   */
  headerTrailing?: ReactNode;
  className?: string;
  'data-testid'?: string;
}

const EMPTY_SELECTION: RowSelectionState = {};
const EMPTY_SORTING: readonly TableSorting[] = [];

/** TanStack 會把預設寬度（150）併進每個 columnDef；清掉它，TableHeader 才分得出「沒宣告 size」。 */
const DEFAULT_COLUMN = { size: undefined };

/**
 * 資料表格：TanStack Table 負責欄位模型，排序、分頁都交給伺服器（只回報使用者的操作）。
 * 各層的實作拆在 `TableHeader`（排序）、`TableRow`（點擊與選取）、`TableSkeleton`（載入中）。
 */
export function Table<TData>({
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
  className,
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: TableProps<TData>) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  const table = useReactTable({
    data,
    columns,
    defaultColumn: DEFAULT_COLUMN,
    getCoreRowModel: getCoreRowModel(),
    getRowId,
    state: { rowSelection },
    enableRowSelection: Boolean(onRowSelectionChange),
    onRowSelectionChange: (updater: Updater<RowSelectionState>) => {
      onRowSelectionChange?.(typeof updater === 'function' ? updater(rowSelection) : updater);
    },
    manualPagination: true,
    manualSorting: true,
  });

  // 尚未勾選任何一列時，單擊列身不做任何事
  const selectable = Boolean(onRowSelectionChange) && Object.values(rowSelection).some(Boolean);

  return (
    <div className={cn(styles.root, className)} {...rest}>
      <table {...slot('table', styles.table)} aria-busy={loading || undefined}>
        <TableHeader
          headerGroups={table.getHeaderGroups()}
          sorting={sorting}
          onSortingChange={onSortingChange}
          trailing={headerTrailing}
          slot={slot}
        />
        <tbody {...slot('body')}>
          {loading ? (
            <TableSkeleton columnCount={table.getVisibleLeafColumns().length} slot={slot} />
          ) : (
            table
              .getRowModel()
              .rows.map((row) => (
                <TableRow
                  key={row.id}
                  row={row}
                  selectable={selectable}
                  onDoubleClick={onRowDoubleClick}
                  slot={slot}
                />
              ))
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
