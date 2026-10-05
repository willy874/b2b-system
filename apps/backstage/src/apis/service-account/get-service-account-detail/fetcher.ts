import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getServiceAccountControllerFindOneUrl } from '@/shared/api-sdk';
import type { ServiceAccount } from '@/shared/api-sdk';

export const fetchServiceAccountDetailQuery = defineAuthFetcher<
  HttpRequestDTO<{ serviceAccountId: string }>,
  ServiceAccount
>((http, request) =>
  http.request(getServiceAccountControllerFindOneUrl({ id: request.params.serviceAccountId }), {
    method: 'GET',
  }),
);
