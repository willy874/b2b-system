import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { TenantListRoute } from '../../routes';
import type { TenantSearchQuery } from '../../routes';

/** 列表的分頁、關鍵字、狀態篩選與排序全部放在網址；改條件或排序時回到第一頁。 */
export function useTenantSearchFilter() {
  const search = TenantListRoute.useSearch();
  const navigate = useNavigate();

  const patch = useCallback(
    (next: Partial<TenantSearchQuery>) => {
      void navigate({ to: TenantListRoute.to, search: { ...search, ...next } });
    },
    [navigate, search],
  );

  return {
    search,
    setFilters: (filters: Partial<Omit<TenantSearchQuery, 'offset' | 'limit'>>) =>
      patch({ ...filters, offset: 0 }),
    setPage: (offset: number, limit: number) => patch({ offset, limit }),
    setSort: (sort: TenantSearchQuery['sort']) => patch({ sort, offset: 0 }),
  };
}
