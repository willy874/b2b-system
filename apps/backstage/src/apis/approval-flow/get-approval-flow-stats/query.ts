import { queryOptions } from '@tanstack/react-query';

import { fetchApprovalFlowStatsQuery } from './fetcher';

export const APPROVAL_FLOW_STATS_QUERY_KEY = 'APPROVAL_FLOW_STATS_QUERY_KEY';

/** 流程的實際運作（近 30 天；docs/architecture/backend/20-approval.md §9.16）。任何一筆審批改變都會讓它失效。 */
export const getApprovalFlowStatsQueryOptions = (type: string) =>
  queryOptions({
    queryKey: [APPROVAL_FLOW_STATS_QUERY_KEY, type] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchApprovalFlowStatsQuery({ params: { type: queryKey[1] }, signal }),
  });
