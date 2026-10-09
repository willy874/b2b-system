import { queryOptions } from '@tanstack/react-query';

import { fetchApprovalCountsQuery } from './fetcher';

export const APPROVAL_COUNTS_QUERY_KEY = 'APPROVAL_COUNTS_QUERY_KEY';

/**
 * 待審數（側欄的徽章、首頁的待辦；docs/architecture/backend/20-approval.md §11.1）。`approval` 的推播讓它失效，
 * 另外沿用視窗聚焦時重抓，補推播斷線的空窗；不輪詢（§12 D3）。
 */
export const getApprovalCountsQueryOptions = () =>
  queryOptions({
    queryKey: [APPROVAL_COUNTS_QUERY_KEY] as const,
    queryFn: ({ signal }) => fetchApprovalCountsQuery({ params: {}, signal }),
  });
