import { queryOptions } from '@tanstack/react-query';

import { fetchMfaMethodListQuery } from './fetcher';

export const MFA_METHOD_LIST_QUERY_KEY = 'MFA_METHOD_LIST_QUERY_KEY';

export const getMfaMethodListQueryOptions = () =>
  queryOptions({
    queryKey: [MFA_METHOD_LIST_QUERY_KEY] as const,
    queryFn: ({ signal }) => fetchMfaMethodListQuery({ params: undefined, signal }),
  });
