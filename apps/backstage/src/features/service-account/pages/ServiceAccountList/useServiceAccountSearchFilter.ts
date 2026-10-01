import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { ServiceAccountListRoute } from '../../routes';
import type { ServiceAccountSearchQuery } from '../../routes';

/** 列表的分頁、關鍵字、排序全部放在網址。 */
export function useServiceAccountSearchFilter() {
  const search = ServiceAccountListRoute.useSearch();
  const navigate = useNavigate({ from: ServiceAccountListRoute.fullPath });

  const patch = useCallback(
    (next: Partial<ServiceAccountSearchQuery>) => {
      void navigate({ to: ServiceAccountListRoute.to, search: { ...search, ...next } });
    },
    [navigate, search],
  );

  return {
    search,
    /** 改關鍵字就回到第一頁。 */
    setKeyword: (keyword: string | undefined) =>
      patch({ keyword: keyword || undefined, offset: 0 }),
    setSort: (sort: ServiceAccountSearchQuery['sort']) => patch({ sort, offset: 0 }),
    setPage: (offset: number, limit: number) => patch({ offset, limit }),
  };
}
