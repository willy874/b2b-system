import { queryOptions } from '@tanstack/react-query';

import { fetchVerifySetupQuery } from './fetcher';

export const AUTH_SETUP_VERIFY_QUERY_KEY = 'AUTH_SETUP_VERIFY_QUERY_KEY';

export const getVerifySetupQueryOptions = (token: string) =>
  queryOptions({
    queryKey: [AUTH_SETUP_VERIFY_QUERY_KEY, token] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchVerifySetupQuery({ params: { token: queryKey[1] }, signal }),
    staleTime: Infinity,
  });
