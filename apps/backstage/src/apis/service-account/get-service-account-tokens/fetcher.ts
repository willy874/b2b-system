import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getServiceAccountControllerListTokensUrl } from '@/shared/api-sdk';
import type { ApiTokenList } from '@/shared/api-sdk';

export const fetchServiceAccountTokensQuery = defineAuthFetcher<
  HttpRequestDTO<{ serviceAccountId: string }>,
  ApiTokenList
>((http, request) =>
  http.request(getServiceAccountControllerListTokensUrl({ id: request.params.serviceAccountId }), {
    method: 'GET',
  }),
);
