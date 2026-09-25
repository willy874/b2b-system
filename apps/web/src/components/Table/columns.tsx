import type { CellContext, ColumnDef, HeaderContext, RowData } from '@tanstack/react-table';

import { Checkbox } from '../Checkbox';

declare module '@tanstack/react-table' {
  // oxlint-disable-next-line typescript/no-unused-vars -- 型別參數要與 TanStack 的宣告一致才能合併
  interface ColumnMeta<TData extends RowData, TValue> {
    /**
     * 表頭不是字串（例如勾選框）的欄位在欄位設定裡顯示的名稱；
     * 有它的欄位才能被設定（排序、隱藏、固定）。
     */
    settingsLabel?: string;
  }
}

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
export function createSelectColumn<TData>(
  labels: SelectColumnLabels = DEFAULT_LABELS,
): ColumnDef<TData, unknown> {
  return {
    id: SELECT_COLUMN_ID,
    size: UTILITY_COLUMN_SIZE,
    enableSorting: false,
    meta: { settingsLabel: labels.column },
    header: ({ table }: HeaderContext<TData, unknown>) => (
      <Checkbox
        aria-label={labels.selectAll}
        checked={table.getIsAllPageRowsSelected()}
        indeterminate={!table.getIsAllPageRowsSelected() && table.getIsSomePageRowsSelected()}
        onCheckedChange={(checked) => table.toggleAllPageRowsSelected(checked)}
        data-testid="table-select-all"
      />
    ),
    cell: ({ row }: CellContext<TData, unknown>) => (
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
