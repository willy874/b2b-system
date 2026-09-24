import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import type { SortOrderType } from '@/shared/constants';

import { RoleListRoute } from '../../routes';
import type { RoleSearchQuery } from '../../routes';

/** 列表的分頁、篩選、排序全部放在網址。 */
export function useRoleSearchFilter() {
  const search = RoleListRoute.useSearch();
  const navigate = useNavigate({ from: RoleListRoute.fullPath });

  const patch = useCallback(
    (next: Partial<RoleSearchQuery>) => {
      void navigate({ to: RoleListRoute.to, search: { ...search, ...next } });
    },
    [navigate, search],
  );

  return {
    search,
    /** 篩選面板送出時一次更新，改篩選條件就回到第一頁。 */
    setFilters: (filters: Pick<RoleSearchQuery, 'keyword' | 'sort'>) =>
      patch({ ...filters, offset: 0 }),
    /** 表頭點擊：換成只依這一欄排序（多欄排序在篩選面板設定）。 */
    setSort: (sort: RoleSearchQuery['sort'][number]['sort'], order: SortOrderType) =>
      patch({ sort: [{ sort, order }], offset: 0 }),
    setPage: (offset: number, limit: number) => patch({ offset, limit }),
  };
}
