import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getApiTokenControllerCreateUrl } from '@/shared/api-sdk';
import type { CreateApiTokenRequest, CreatedApiToken } from '@/shared/api-sdk';

export const fetchMyApiTokenCreateMutation = defineAuthFetcher<
  HttpRequestDTO<CreateApiTokenRequest>,
  CreatedApiToken
>((http, request) =>
  http.request(getApiTokenControllerCreateUrl(), jsonBody(request.params, { method: 'POST' })),
);
