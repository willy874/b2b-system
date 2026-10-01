import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getServiceAccountControllerRevokeTokenUrl } from '@/shared/api-sdk';

export const fetchServiceAccountTokenRevokeMutation = defineAuthFetcher<
  HttpRequestDTO<{ serviceAccountId: string; tokenId: string }>,
  undefined
>((http, request) =>
  http.request(
    getServiceAccountControllerRevokeTokenUrl({
      id: request.params.serviceAccountId,
      tokenId: request.params.tokenId,
    }),
    { method: 'DELETE' },
  ),
);
