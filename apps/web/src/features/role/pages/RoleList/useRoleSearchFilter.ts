import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

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
    setKeyword: (keyword: string) => patch({ keyword: keyword || undefined, offset: 0 }),
    setSort: (sortBy: RoleSearchQuery['sortBy'], sortOrder: RoleSearchQuery['sortOrder']) =>
      patch({ sortBy, sortOrder, offset: 0 }),
    setPage: (offset: number, limit: number) => patch({ offset, limit }),
  };
}
