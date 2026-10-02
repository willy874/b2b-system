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
    setFilters: (filters: Pick<UserSearchQuery, 'keyword' | 'status' | 'tagId' | 'sort'>) =>
      patch({ ...filters, offset: 0 }),
    /** 表頭點擊：整組多欄排序換成點擊後的結果，回到第一頁。 */
    setSort: (sort: UserSearchQuery['sort']) => patch({ sort, offset: 0 }),
    setPage: (offset: number, limit: number) => patch({ offset, limit }),
  };
}
