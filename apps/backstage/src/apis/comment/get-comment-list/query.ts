import { infiniteQueryOptions } from '@tanstack/react-query';

import type { CommentPage } from '@/shared/api-sdk';

import type { CommentTargetParams } from '../types';
import { fetchCommentListQuery } from './fetcher';

/** 第二、三個元素是資源類型與 id。 */
export const COMMENT_LIST_QUERY_KEY = 'COMMENT_LIST_QUERY_KEY';

export const COMMENT_PAGE_SIZE = 20;

/**
 * 一個資源的留言：新的在前，以 keyset 游標（`nextCursor`）載入較舊的（docs/architecture/backend/24-comment.md §3.1）。
 * 推播讓它失效時，TanStack 依序以游標重抓已載入的頁數。
 */
export const getCommentListQueryOptions = ({ resourceType, resourceId }: CommentTargetParams) =>
  infiniteQueryOptions({
    queryKey: [COMMENT_LIST_QUERY_KEY, resourceType, resourceId] as const,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: CommentPage) => lastPage.nextCursor ?? undefined,
    queryFn: ({ signal, pageParam }) =>
      fetchCommentListQuery({
        params: { resourceType, resourceId, limit: COMMENT_PAGE_SIZE, cursor: pageParam },
        signal,
      }),
  });
