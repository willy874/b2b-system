import { queryOptions } from '@tanstack/react-query';

import { fetchApprovalDetailQuery } from './fetcher';

export const APPROVAL_DETAIL_QUERY_KEY = 'APPROVAL_DETAIL_QUERY_KEY';

export const getApprovalDetailQueryOptions = (approvalId: string) =>
  queryOptions({
    queryKey: [APPROVAL_DETAIL_QUERY_KEY, approvalId] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchApprovalDetailQuery({ params: { approvalId: queryKey[1] }, signal }),
  });
