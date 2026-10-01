import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getUserApiTokenControllerRevokeUrl } from '@/shared/api-sdk';

export const fetchUserApiTokenRevokeMutation = defineAuthFetcher<
  HttpRequestDTO<{ userId: string; tokenId: string }>,
  undefined
>((http, request) =>
  http.request(
    getUserApiTokenControllerRevokeUrl({
      userId: request.params.userId,
      tokenId: request.params.tokenId,
    }),
    { method: 'DELETE' },
  ),
);
