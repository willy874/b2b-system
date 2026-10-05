import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getServiceAccountControllerUpdateUrl } from '@/shared/api-sdk';
import type { ServiceAccount, UpdateServiceAccountRequest } from '@/shared/api-sdk';

export const fetchServiceAccountUpdateMutation = defineAuthFetcher<
  HttpRequestDTO<{ serviceAccountId: string; body: UpdateServiceAccountRequest }>,
  ServiceAccount
>((http, request) =>
  http.request(
    getServiceAccountControllerUpdateUrl({ id: request.params.serviceAccountId }),
    jsonBody(request.params.body, { method: 'PATCH' }),
  ),
);
