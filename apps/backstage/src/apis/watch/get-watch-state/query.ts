import { queryOptions } from '@tanstack/react-query';

import type { CommentTargetParams } from '@/apis/comment/types';

import { fetchWatchStateQuery } from './fetcher';

/** 第二、三個元素是資源類型與 id。 */
export const WATCH_STATE_QUERY_KEY = 'WATCH_STATE_QUERY_KEY';

/** 自己有沒有關注、關注的人數（docs/architecture/backend/24-comment.md §3.2）。 */
export const getWatchStateQueryOptions = ({ resourceType, resourceId }: CommentTargetParams) =>
  queryOptions({
    queryKey: [WATCH_STATE_QUERY_KEY, resourceType, resourceId] as const,
    queryFn: ({ signal }) => fetchWatchStateQuery({ params: { resourceType, resourceId }, signal }),
  });
