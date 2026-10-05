import { describe, expect, it } from 'vitest';

import { toggleSorting } from './sorting';
import type { TableSorting } from './sorting';

const NAME_ASC: TableSorting = { sortBy: 'name', sortOrder: 'asc' };
const QTY_DESC: TableSorting = { sortBy: 'qty', sortOrder: 'desc' };

describe('toggleSorting（不排 → 升冪 → 降冪 → 不排）', () => {
  it('未排序的欄位以升冪加到最後', () => {
    expect(toggleSorting([QTY_DESC], 'name')).toEqual([QTY_DESC, NAME_ASC]);
  });

  it('升冪換成降冪，優先順序不變', () => {
    expect(toggleSorting([NAME_ASC, QTY_DESC], 'name')).toEqual([
      { sortBy: 'name', sortOrder: 'desc' },
      QTY_DESC,
    ]);
  });

  it('降冪移除，後面的條件往前遞補', () => {
    expect(toggleSorting([QTY_DESC, NAME_ASC], 'qty')).toEqual([NAME_ASC]);
  });

  it('不改動傳入的陣列', () => {
    const sorting = [NAME_ASC];
    toggleSorting(sorting, 'name');
    expect(sorting).toEqual([NAME_ASC]);
  });
});
