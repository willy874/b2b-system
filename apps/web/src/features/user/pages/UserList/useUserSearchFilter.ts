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
    setKeyword: (keyword: string) => patch({ keyword: keyword || undefined, offset: 0 }),
    setStatus: (status: UserSearchQuery['status']) => patch({ status, offset: 0 }),
    setSort: (sortBy: UserSearchQuery['sortBy'], sortOrder: UserSearchQuery['sortOrder']) =>
      patch({ sortBy, sortOrder, offset: 0 }),
    setPage: (offset: number, limit: number) => patch({ offset, limit }),
  };
}
