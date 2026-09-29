import { queryOptions } from '@tanstack/react-query';

import { fetchVerifySetupQuery } from './fetcher';

export const AUTH_SETUP_VERIFY_QUERY_KEY = 'AUTH_SETUP_VERIFY_QUERY_KEY';

export const getVerifySetupQueryOptions = (token: string, tenant: string) =>
  queryOptions({
    queryKey: [AUTH_SETUP_VERIFY_QUERY_KEY, tenant, token] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchVerifySetupQuery({ params: { tenant: queryKey[1], token: queryKey[2] }, signal }),
    staleTime: Infinity,
  });
