import { queryOptions } from '@tanstack/react-query';

import { fetchSsoInteractionQuery } from './fetcher';

export const SSO_INTERACTION_QUERY_KEY = 'SSO_INTERACTION_QUERY_KEY';

export const getSsoInteractionQueryOptions = (uid: string) =>
  queryOptions({
    queryKey: [SSO_INTERACTION_QUERY_KEY, uid] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchSsoInteractionQuery({ params: { uid: queryKey[1] }, signal }),
    // 過期或無效的互動重試也不會變有效
    retry: false,
    staleTime: Infinity,
  });
