import { queryOptions } from '@tanstack/react-query';

import type { CommentTargetParams } from '../types';
import { fetchMentionableUsersQuery } from './fetcher';

/** 第二到四個元素是資源類型、id 與關鍵字。 */
export const MENTIONABLE_USERS_QUERY_KEY = 'MENTIONABLE_USERS_QUERY_KEY';

/** @提及的候選：看得到這個資源的人（最多 10 位，docs/architecture/backend/24-comment.md §8.2 D6）。 */
export const getMentionableUsersQueryOptions = (
  { resourceType, resourceId }: CommentTargetParams,
  keyword: string,
) =>
  queryOptions({
    queryKey: [MENTIONABLE_USERS_QUERY_KEY, resourceType, resourceId, keyword] as const,
    queryFn: ({ signal }) =>
      fetchMentionableUsersQuery({ params: { resourceType, resourceId, keyword }, signal }),
    staleTime: 30_000,
  });
