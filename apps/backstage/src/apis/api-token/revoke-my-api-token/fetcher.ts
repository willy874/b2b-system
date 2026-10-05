import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getApiTokenControllerRevokeUrl } from '@/shared/api-sdk';

export const fetchMyApiTokenRevokeMutation = defineAuthFetcher<
  HttpRequestDTO<{ tokenId: string }>,
  undefined
>((http, request) =>
  http.request(getApiTokenControllerRevokeUrl({ tokenId: request.params.tokenId }), {
    method: 'DELETE',
  }),
);
