import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import { fetchGroupMembersQuery } from './fetcher';

export const GROUP_MEMBERS_QUERY_KEY = 'GROUP_MEMBERS_QUERY_KEY';

export const getGroupMembersQueryOptions = (groupId: string, offset = 0, limit = 50) =>
  queryOptions({
    queryKey: [GROUP_MEMBERS_QUERY_KEY, groupId, offset, limit] as const,
    placeholderData: keepPreviousData,
    queryFn: ({ queryKey, signal }) =>
      fetchGroupMembersQuery({
        params: { groupId: queryKey[1], offset: queryKey[2], limit: queryKey[3] },
        signal,
      }),
  });
