import { queryOptions } from '@tanstack/react-query';

import { fetchAuditLogDetailQuery } from './fetcher';

export const AUDIT_LOG_DETAIL_QUERY_KEY = 'AUDIT_LOG_DETAIL_QUERY_KEY';

export const getAuditLogDetailQueryOptions = (id: string) =>
  queryOptions({
    queryKey: [AUDIT_LOG_DETAIL_QUERY_KEY, id] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchAuditLogDetailQuery({ params: { id: queryKey[1] }, signal }),
  });
