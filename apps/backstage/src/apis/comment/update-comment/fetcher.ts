import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getCommentControllerUpdateUrl } from '@/shared/api-sdk';
import type { Comment, UpdateCommentRequest } from '@/shared/api-sdk';

export const fetchCommentUpdateMutation = defineAuthFetcher<
  HttpRequestDTO<{ commentId: string } & UpdateCommentRequest>,
  Comment
>((http, request) => {
  const { commentId, ...body } = request.params;
  return http.request(
    getCommentControllerUpdateUrl({ id: commentId }),
    jsonBody(body, { method: 'PATCH' }),
  );
});
