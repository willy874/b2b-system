import { queryOptions } from '@tanstack/react-query';

import { fetchUserMfaQuery } from './fetcher';

export const USER_MFA_QUERY_KEY = 'USER_MFA_QUERY_KEY';

export const getUserMfaQueryOptions = (id: string) =>
  queryOptions({
    queryKey: [USER_MFA_QUERY_KEY, { id }] as const,
    queryFn: ({ signal }) => fetchUserMfaQuery({ params: { id }, signal }),
  });
