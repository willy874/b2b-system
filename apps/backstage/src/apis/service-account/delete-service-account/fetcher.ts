import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getServiceAccountControllerRemoveUrl } from '@/shared/api-sdk';

export const fetchServiceAccountDeleteMutation = defineAuthFetcher<
  HttpRequestDTO<{ serviceAccountId: string }>,
  undefined
>((http, request) =>
  http.request(getServiceAccountControllerRemoveUrl({ id: request.params.serviceAccountId }), {
    method: 'DELETE',
  }),
);
