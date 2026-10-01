import { queryOptions } from '@tanstack/react-query';

import { fetchServiceAccountTokensQuery } from './fetcher';

export const SERVICE_ACCOUNT_TOKENS_QUERY_KEY = 'SERVICE_ACCOUNT_TOKENS_QUERY_KEY';

export const getServiceAccountTokensQueryOptions = (serviceAccountId: string) =>
  queryOptions({
    queryKey: [SERVICE_ACCOUNT_TOKENS_QUERY_KEY, serviceAccountId] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchServiceAccountTokensQuery({ params: { serviceAccountId: queryKey[1] }, signal }),
  });
