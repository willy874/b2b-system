import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getTagControllerCreateUrl } from '@/shared/api-sdk';
import type { CreateTagRequest, Tag } from '@/shared/api-sdk';

export const fetchTagCreateMutation = defineAuthFetcher<HttpRequestDTO<CreateTagRequest>, Tag>(
  (http, request) =>
    http.request(getTagControllerCreateUrl(), jsonBody(request.params, { method: 'POST' })),
);
