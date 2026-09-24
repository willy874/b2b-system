import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import type { ColumnDef, Row, RowSelectionState, Updater } from '@tanstack/react-table';
import type { ReactNode, Ref } from 'react';

import { cn } from '@/shared/utils';

import { Empty } from '../Empty';
import { Skeleton } from '../Skeleton';
import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import styles from './Table.module.css';

/** `className` 落在最外層容器；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type TableSlot =
  | 'table'
  | 'head'
  | 'headerRow'
  | 'headerCell'
  | 'sortIndicator'
  | 'body'
  | 'row'
  | 'cell'
  | 'empty';

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
  sorting?: { sortBy: string; sortOrder: 'asc' | 'desc' };
  onSortingChange?: (sortBy: string, sortOrder: 'asc' | 'desc') => void;
  className?: string;
  'data-testid'?: string;
}

export function Table<TData>({
  data,
  columns,
  getRowId,
  loading,
  emptyTitle = '沒有資料',
  emptyDescription,
  rowSelection,
  onRowSelectionChange,
  onRowDoubleClick,
  sorting,
  onSortingChange,
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
    getCoreRowModel: getCoreRowModel(),
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
    state: { rowSelection: rowSelection ?? {} },
    enableRowSelection: Boolean(onRowSelectionChange),
    onRowSelectionChange: (updater: Updater<RowSelectionState>) => {
      if (!onRowSelectionChange) return;
      const next = typeof updater === 'function' ? updater(rowSelection ?? {}) : updater;
      onRowSelectionChange(next);
    },
    manualPagination: true,
    manualSorting: true,
  });

  const selectionMode = Object.values(rowSelection ?? {}).some(Boolean);

  const handleRowClick = (row: Row<TData>) => {
    // 尚未進入選取模式時，單擊列身不做任何事
    if (!selectionMode || !onRowSelectionChange) return;
    row.toggleSelected();
  };

  return (
    <div className={cn(styles.root, className)} {...rest}>
      <table {...slot('table', styles.table)} aria-busy={loading || undefined}>
        <thead {...slot('head', styles.head)}>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} {...slot('headerRow')}>
              {headerGroup.headers.map((header) => {
                const sortable = header.column.columnDef.enableSorting !== false && onSortingChange;
                const active = sorting?.sortBy === header.column.id;
                return (
                  <th
                    key={header.id}
                    {...slot('headerCell', styles.headerCell, {
                      style: { width: header.getSize() === 150 ? undefined : header.getSize() },
                    })}
                    data-sortable={sortable ? true : undefined}
                    aria-sort={
                      active
                        ? sorting?.sortOrder === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : undefined
                    }
                    onClick={
                      sortable
                        ? () =>
                            onSortingChange(
                              header.column.id,
                              active && sorting?.sortOrder === 'asc' ? 'desc' : 'asc',
                            )
                        : undefined
                    }
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                    {active && (
                      <span {...slot('sortIndicator', styles.sortIndicator)}>
                        {sorting?.sortOrder === 'asc' ? '▲' : '▼'}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody {...slot('body')}>
          {/* 骨架列只套 class 與 style，不帶 testid：E2E 數 table-row 時不能把它算進去 */}
          {loading &&
            Array.from({ length: 5 }, (_, index) => (
              <tr
                key={`skeleton-${index}`}
                className={cn(styles.row, classNames?.row)}
                style={styleOverrides?.row}
              >
                {columns.map((_column, columnIndex) => (
                  <td
                    key={`skeleton-cell-${columnIndex}`}
                    className={cn(styles.cell, classNames?.cell)}
                    style={styleOverrides?.cell}
                  >
                    <Skeleton height={14} />
                  </td>
                ))}
              </tr>
            ))}

          {!loading &&
            table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                {...slot('row', styles.row, { testId: 'table-row' })}
                data-value={row.id}
                data-selected={row.getIsSelected() || undefined}
                onClick={() => handleRowClick(row)}
                onDoubleClick={() => onRowDoubleClick?.(row.original)}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} {...slot('cell', styles.cell)}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
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
