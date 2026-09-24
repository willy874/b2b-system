import type { AriaAttributes } from 'react';

export type TableSortOrder = 'asc' | 'desc';

/** 伺服器端排序的狀態；表格本身不排序（`manualSorting`），只回報使用者點了哪一欄。 */
export interface TableSorting {
  sortBy: string;
  sortOrder: TableSortOrder;
}

export const ARIA_SORT = {
  asc: 'ascending',
  desc: 'descending',
} as const satisfies Record<TableSortOrder, AriaAttributes['aria-sort']>;

/** 點擊表頭後的方向：已經是升冪就換降冪，其餘（含未排序的欄位）一律從升冪開始。 */
export function nextSortOrder(current: TableSortOrder | undefined): TableSortOrder {
  return current === 'asc' ? 'desc' : 'asc';
}
