import type { RowData } from '@tanstack/react-table';

import { Checkbox } from '../Checkbox';
import type { TableCellContext, TableColumnDef, TableHeaderContext } from './features';

/** 勾選欄的 id；`RichTable` 預設把它固定在 start。 */
export const SELECT_COLUMN_ID = '__select';

/** 工具欄（勾選、釘選）的寬度：只放一個圖示或勾選框。 */
export const UTILITY_COLUMN_SIZE = 44;

export interface SelectColumnLabels {
  /** 欄位設定裡的名稱，例如「勾選」。 */
  column: string;
  /** 表頭勾選框的無障礙名稱，例如「全選本頁」。 */
  selectAll: string;
  /** 每一列勾選框的無障礙名稱，例如「選取這一列」。 */
  selectRow: string;
}

const DEFAULT_LABELS: SelectColumnLabels = {
  column: '勾選',
  selectAll: '全選本頁',
  selectRow: '選取這一列',
};

/**
 * 勾選欄（CheckboxColumn）：表頭全選／取消本頁（部分勾選時顯示半選），每一列一個勾選框。
 * 需要 `Table` 的 `rowSelection` ＋ `onRowSelectionChange`；跨頁保留選取用 `useTableSelection`。
 * 以 `meta.settingsLabel` 進入欄位設定（可排序、隱藏、固定）。
 */
export function createSelectColumn<TData extends RowData>(
  labels: SelectColumnLabels = DEFAULT_LABELS,
): TableColumnDef<TData> {
  return {
    id: SELECT_COLUMN_ID,
    size: UTILITY_COLUMN_SIZE,
    enableSorting: false,
    meta: { settingsLabel: labels.column },
    header: ({ table }: TableHeaderContext<TData>) => (
      <Checkbox
        aria-label={labels.selectAll}
        checked={table.getIsAllPageRowsSelected()}
        indeterminate={!table.getIsAllPageRowsSelected() && table.getIsSomePageRowsSelected()}
        onCheckedChange={(checked) => table.toggleAllPageRowsSelected(checked)}
        data-testid="table-select-all"
      />
    ),
    cell: ({ row }: TableCellContext<TData>) => (
      <Checkbox
        aria-label={labels.selectRow}
        checked={row.getIsSelected()}
        disabled={!row.getCanSelect()}
        onCheckedChange={(checked) => row.toggleSelected(checked)}
        data-testid="table-select-row"
      />
    ),
  };
}
