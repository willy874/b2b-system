import type { AriaAttributes } from 'react';

import type { IconName } from '../Icon';

export type TableSortOrder = 'asc' | 'desc';

/** 伺服器端排序的一個條件；表格本身不排序（`manualSorting`），只回報使用者點了哪一欄。 */
export interface TableSorting {
  sortBy: string;
  sortOrder: TableSortOrder;
}

export const ARIA_SORT = {
  asc: 'ascending',
  desc: 'descending',
} as const satisfies Record<TableSortOrder, AriaAttributes['aria-sort']>;

export const SORT_ICON = {
  none: 'arrow-up-down',
  asc: 'arrow-up',
  desc: 'arrow-down',
} as const satisfies Record<TableSortOrder | 'none', IconName>;

/**
 * 點擊表頭後的多欄排序（陣列順序即優先順序）。每一欄依序循環：
 * 不排 → 升冪（加到最後，優先順序最低）→ 降冪（留在原位）→ 不排（移除，後面的往前遞補）。
 */
export function toggleSorting(sorting: readonly TableSorting[], sortBy: string): TableSorting[] {
  const current = sorting.find((entry) => entry.sortBy === sortBy);
  if (!current) return [...sorting, { sortBy, sortOrder: 'asc' }];
  if (current.sortOrder === 'asc') {
    return sorting.map((entry) => (entry === current ? { sortBy, sortOrder: 'desc' } : entry));
  }
  return sorting.filter((entry) => entry !== current);
}
