import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getServiceAccountControllerRemoveUrl } from '@/shared/api-sdk';

export const fetchServiceAccountDeleteMutation = defineAuthFetcher<
  HttpRequestDTO<{ serviceAccountId: string }>,
  undefined
>((http, request) =>
  http.request(getServiceAccountControllerRemoveUrl({ id: request.params.serviceAccountId }), {
    method: 'DELETE',
  }),
);
