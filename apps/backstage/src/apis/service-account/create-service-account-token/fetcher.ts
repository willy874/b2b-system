import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getServiceAccountControllerCreateTokenUrl } from '@/shared/api-sdk';
import type { CreateApiTokenRequest, CreatedApiToken } from '@/shared/api-sdk';

export const fetchServiceAccountTokenCreateMutation = defineAuthFetcher<
  HttpRequestDTO<{ serviceAccountId: string; body: CreateApiTokenRequest }>,
  CreatedApiToken
>((http, request) =>
  http.request(
    getServiceAccountControllerCreateTokenUrl({ id: request.params.serviceAccountId }),
    jsonBody(request.params.body, { method: 'POST' }),
  ),
);
