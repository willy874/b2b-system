import { queryOptions } from '@tanstack/react-query';

import { fetchApprovalFlowDetailQuery } from './fetcher';

export const APPROVAL_FLOW_DETAIL_QUERY_KEY = 'APPROVAL_FLOW_DETAIL_QUERY_KEY';

export const getApprovalFlowDetailQueryOptions = (type: string) =>
  queryOptions({
    queryKey: [APPROVAL_FLOW_DETAIL_QUERY_KEY, type] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchApprovalFlowDetailQuery({ params: { type: queryKey[1] }, signal }),
  });
