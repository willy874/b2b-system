import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import type { ColumnDef, Row, RowSelectionState, Updater } from '@tanstack/react-table';
import type { ReactNode, Ref } from 'react';

import { cn } from '@/shared/utils';

import { Empty } from '../Empty';
import { Skeleton } from '../Skeleton';

import './Table.css';

export interface TableProps<TData> {
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
  ...rest
}: TableProps<TData>) {
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
    <div className={cn('ge-table__wrapper', className)} {...rest}>
      <table className="ge-table" aria-busy={loading || undefined}>
        <thead className="ge-table__head">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const sortable = header.column.columnDef.enableSorting !== false && onSortingChange;
                const active = sorting?.sortBy === header.column.id;
                return (
                  <th
                    key={header.id}
                    className={cn('ge-table__th', sortable && 'ge-table__th--sortable')}
                    style={{ width: header.getSize() === 150 ? undefined : header.getSize() }}
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
                      <span className="ge-table__sort">
                        {sorting?.sortOrder === 'asc' ? '▲' : '▼'}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {loading &&
            Array.from({ length: 5 }, (_, index) => (
              <tr key={`skeleton-${index}`} className="ge-table__row">
                {columns.map((_column, columnIndex) => (
                  <td key={`skeleton-cell-${columnIndex}`} className="ge-table__td">
                    <Skeleton height={14} />
                  </td>
                ))}
              </tr>
            ))}

          {!loading &&
            table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className={cn('ge-table__row', row.getIsSelected() && 'ge-table__row--selected')}
                data-testid="table-row"
                onClick={() => handleRowClick(row)}
                onDoubleClick={() => onRowDoubleClick?.(row.original)}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="ge-table__td">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>

      {!loading && data.length === 0 && (
        <Empty title={emptyTitle} description={emptyDescription} data-testid="table-empty" />
      )}
    </div>
  );
}
