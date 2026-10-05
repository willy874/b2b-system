import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

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
