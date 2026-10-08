import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getCommentControllerListUrl } from '@/shared/api-sdk';
import type { CommentPage } from '@/shared/api-sdk';

import type { CommentTargetParams } from '../types';

export const fetchCommentListQuery = defineAuthFetcher<
  HttpRequestDTO<CommentTargetParams & { limit: number; cursor?: string }>,
  CommentPage
>((http, request) =>
  http.request(
    withQuery(
      getCommentControllerListUrl({
        resourceType: request.params.resourceType,
        resourceId: request.params.resourceId,
      }),
      { limit: request.params.limit, cursor: request.params.cursor },
    ),
    { method: 'GET' },
  ),
);
