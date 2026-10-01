import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { GroupListRoute } from '../../routes';
import type { GroupSearchQuery } from '../../routes';

/** 列表的分頁、關鍵字、排序全部放在網址。 */
export function useGroupSearchFilter() {
  const search = GroupListRoute.useSearch();
  const navigate = useNavigate({ from: GroupListRoute.fullPath });

  const patch = useCallback(
    (next: Partial<GroupSearchQuery>) => {
      void navigate({ to: GroupListRoute.to, search: { ...search, ...next } });
    },
    [navigate, search],
  );

  return {
    search,
    /** 改關鍵字就回到第一頁。 */
    setKeyword: (keyword: string | undefined) =>
      patch({ keyword: keyword || undefined, offset: 0 }),
    /** 表頭點擊：整組多欄排序換成點擊後的結果，回到第一頁。 */
    setSort: (sort: GroupSearchQuery['sort']) => patch({ sort, offset: 0 }),
    setPage: (offset: number, limit: number) => patch({ offset, limit }),
  };
}
