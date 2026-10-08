import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getCommentControllerRemoveUrl } from '@/shared/api-sdk';

export const fetchCommentDeleteMutation = defineAuthFetcher<
  HttpRequestDTO<{ commentId: string }>,
  undefined
>((http, request) =>
  http.request(getCommentControllerRemoveUrl({ id: request.params.commentId }), {
    method: 'DELETE',
  }),
);
