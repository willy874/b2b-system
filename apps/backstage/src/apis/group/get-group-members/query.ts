import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import { fetchGroupMembersQuery } from './fetcher';
import type { GroupMembersParams } from './fetcher';

export const GROUP_MEMBERS_QUERY_KEY = 'GROUP_MEMBERS_QUERY_KEY';

export const getGroupMembersQueryOptions = ({
  groupId,
  offset,
  limit,
  keyword,
}: GroupMembersParams) =>
  queryOptions({
    queryKey: [GROUP_MEMBERS_QUERY_KEY, groupId, offset, limit, keyword ?? ''] as const,
    placeholderData: keepPreviousData,
    queryFn: ({ queryKey, signal }) =>
      fetchGroupMembersQuery({
        params: {
          groupId: queryKey[1],
          offset: queryKey[2],
          limit: queryKey[3],
          keyword: queryKey[4] || undefined,
        },
        signal,
      }),
  });
