import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getApiTokenControllerCreateUrl } from '@/shared/api-sdk';
import type { CreateApiTokenRequest, CreatedApiToken } from '@/shared/api-sdk';

export const fetchMyApiTokenCreateMutation = defineAuthFetcher<
  HttpRequestDTO<CreateApiTokenRequest>,
  CreatedApiToken
>((http, request) =>
  http.request(getApiTokenControllerCreateUrl(), jsonBody(request.params, { method: 'POST' })),
);
