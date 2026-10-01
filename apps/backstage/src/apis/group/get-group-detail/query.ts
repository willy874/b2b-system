import { queryOptions } from '@tanstack/react-query';

import { fetchGroupDetailQuery } from './fetcher';

export const GROUP_DETAIL_QUERY_KEY = 'GROUP_DETAIL_QUERY_KEY';

export const getGroupDetailQueryOptions = (groupId: string) =>
  queryOptions({
    queryKey: [GROUP_DETAIL_QUERY_KEY, groupId] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchGroupDetailQuery({ params: { groupId: queryKey[1] }, signal }),
  });
