import { queryOptions } from '@tanstack/react-query';

import { fetchUserOrgUnitsQuery } from './fetcher';

/** 使用者詳情的「所屬部門」。 */
export const USER_ORG_UNITS_QUERY_KEY = 'USER_ORG_UNITS_QUERY_KEY';

export const getUserOrgUnitsQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: [USER_ORG_UNITS_QUERY_KEY, userId] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchUserOrgUnitsQuery({ params: { userId: queryKey[1] }, signal }),
  });
