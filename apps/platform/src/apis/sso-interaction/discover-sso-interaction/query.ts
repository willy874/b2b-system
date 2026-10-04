import { queryOptions } from '@tanstack/react-query';

import { fetchDiscoverSsoInteractionQuery } from './fetcher';

export const SSO_DISCOVERY_QUERY_KEY = 'SSO_DISCOVERY_QUERY_KEY';

export const getSsoDiscoveryQueryOptions = (uid: string, email: string) =>
  queryOptions({
    queryKey: [SSO_DISCOVERY_QUERY_KEY, uid, email.toLowerCase()] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchDiscoverSsoInteractionQuery({
        params: { uid: queryKey[1], email: queryKey[2] },
        signal,
      }),
    retry: false,
    staleTime: Infinity,
  });
