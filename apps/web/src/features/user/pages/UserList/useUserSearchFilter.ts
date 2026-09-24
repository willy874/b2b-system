import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { UserListRoute } from '../../routes';
import type { UserSearchQuery } from '../../routes';

/** 列表的分頁、篩選、排序全部放在網址。 */
export function useUserSearchFilter() {
  const search = UserListRoute.useSearch();
  const navigate = useNavigate();

  const patch = useCallback(
    (next: Partial<UserSearchQuery>) => {
      void navigate({ to: UserListRoute.to, search: { ...search, ...next } });
    },
    [navigate, search],
  );

  return {
    search,
    /** 篩選面板送出時一次更新，改篩選條件就回到第一頁。 */
    setFilters: (filters: Pick<UserSearchQuery, 'keyword' | 'status'>) =>
      patch({ ...filters, offset: 0 }),
    setSort: (sortBy: UserSearchQuery['sortBy'], sortOrder: UserSearchQuery['sortOrder']) =>
      patch({ sortBy, sortOrder, offset: 0 }),
    setPage: (offset: number, limit: number) => patch({ offset, limit }),
  };
}
