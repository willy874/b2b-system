import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getTagControllerUpdateUrl } from '@/shared/api-sdk';
import type { Tag, UpdateTagRequest } from '@/shared/api-sdk';

export const fetchTagUpdateMutation = defineAuthFetcher<
  HttpRequestDTO<{ tagId: string; body: UpdateTagRequest }>,
  Tag
>((http, request) =>
  http.request(
    getTagControllerUpdateUrl({ id: request.params.tagId }),
    jsonBody(request.params.body, { method: 'PATCH' }),
  ),
);
