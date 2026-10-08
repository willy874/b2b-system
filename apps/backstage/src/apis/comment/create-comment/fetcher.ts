import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getCommentControllerCreateUrl } from '@/shared/api-sdk';
import type { Comment, CreateCommentRequest } from '@/shared/api-sdk';

import type { CommentTargetParams } from '../types';

export const fetchCommentCreateMutation = defineAuthFetcher<
  HttpRequestDTO<CommentTargetParams & CreateCommentRequest>,
  Comment
>((http, request) => {
  const { resourceType, resourceId, ...body } = request.params;
  return http.request(
    getCommentControllerCreateUrl({ resourceType, resourceId }),
    jsonBody(body, { method: 'POST' }),
  );
});
