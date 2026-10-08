import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getCommentControllerMentionableUrl } from '@/shared/api-sdk';
import type { MentionableList } from '@/shared/api-sdk';

import type { CommentTargetParams } from '../types';

export const fetchMentionableUsersQuery = defineAuthFetcher<
  HttpRequestDTO<CommentTargetParams & { keyword: string }>,
  MentionableList
>((http, request) =>
  http.request(
    withQuery(
      getCommentControllerMentionableUrl({
        resourceType: request.params.resourceType,
        resourceId: request.params.resourceId,
      }),
      { q: request.params.keyword || undefined },
    ),
    { method: 'GET' },
  ),
);
