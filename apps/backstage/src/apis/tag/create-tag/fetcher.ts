import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getTagControllerCreateUrl } from '@/shared/api-sdk';
import type { CreateTagRequest, Tag } from '@/shared/api-sdk';

export const fetchTagCreateMutation = defineAuthFetcher<HttpRequestDTO<CreateTagRequest>, Tag>(
  (http, request) =>
    http.request(getTagControllerCreateUrl(), jsonBody(request.params, { method: 'POST' })),
);
