import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { ApprovalListRoute } from '../../routes';
import type { ApprovalSearchQuery } from '../../routes';

/** 列表的分頁、篩選、排序全部放在網址。 */
export function useApprovalSearchFilter() {
  const search = ApprovalListRoute.useSearch();
  const navigate = useNavigate();

  const patch = useCallback(
    (next: Partial<ApprovalSearchQuery>) => {
      void navigate({ to: ApprovalListRoute.to, search: { ...search, ...next } });
    },
    [navigate, search],
  );

  return {
    search,
    /** 篩選面板送出時一次更新，改篩選條件就回到第一頁。 */
    setFilters: (filters: Pick<ApprovalSearchQuery, 'keyword' | 'type' | 'sort'>) =>
      patch({ ...filters, offset: 0 }),
    /** 狀態的分段切換：回到第一頁。 */
    setStatus: (status: ApprovalSearchQuery['status']) => patch({ status, offset: 0 }),
    /** 表頭點擊：整組多欄排序換成點擊後的結果，回到第一頁。 */
    setSort: (sort: ApprovalSearchQuery['sort']) => patch({ sort, offset: 0 }),
    setPage: (offset: number, limit: number) => patch({ offset, limit }),
  };
}
