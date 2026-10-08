import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { getCommentListQueryOptions } from '@/apis/comment/get-comment-list/query';
import type { CommentTargetParams } from '@/apis/comment/types';

/** 一個資源的留言（新的在前，往下載入較舊的）。 */
export function useComments(target: CommentTargetParams) {
  const query = useInfiniteQuery(getCommentListQueryOptions(target));
  const comments = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  return { query, comments };
}
