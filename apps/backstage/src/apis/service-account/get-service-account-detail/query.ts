import { queryOptions } from '@tanstack/react-query';

import { fetchServiceAccountDetailQuery } from './fetcher';

export const SERVICE_ACCOUNT_DETAIL_QUERY_KEY = 'SERVICE_ACCOUNT_DETAIL_QUERY_KEY';

export const getServiceAccountDetailQueryOptions = (serviceAccountId: string) =>
  queryOptions({
    queryKey: [SERVICE_ACCOUNT_DETAIL_QUERY_KEY, serviceAccountId] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchServiceAccountDetailQuery({ params: { serviceAccountId: queryKey[1] }, signal }),
  });
