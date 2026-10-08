import { queryOptions } from '@tanstack/react-query';

import { fetchApprovalFlowListQuery } from './fetcher';

/** 支援流程的審批類型與它們的流程（docs/architecture/backend/20-approval.md §9）。 */
export const APPROVAL_FLOW_LIST_QUERY_KEY = 'APPROVAL_FLOW_LIST_QUERY_KEY';

export const getApprovalFlowListQueryOptions = () =>
  queryOptions({
    queryKey: [APPROVAL_FLOW_LIST_QUERY_KEY] as const,
    queryFn: ({ signal }) => fetchApprovalFlowListQuery({ params: undefined, signal }),
  });
