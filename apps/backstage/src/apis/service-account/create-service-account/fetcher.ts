import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getServiceAccountControllerCreateUrl } from '@/shared/api-sdk';
import type { CreateServiceAccountRequest, ServiceAccount } from '@/shared/api-sdk';

export const fetchServiceAccountCreateMutation = defineAuthFetcher<
  HttpRequestDTO<CreateServiceAccountRequest>,
  ServiceAccount
>((http, request) =>
  http.request(
    getServiceAccountControllerCreateUrl(),
    jsonBody(request.params, { method: 'POST' }),
  ),
);
