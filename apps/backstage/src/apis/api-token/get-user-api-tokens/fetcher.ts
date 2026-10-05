import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getUserApiTokenControllerListUrl } from '@/shared/api-sdk';
import type { ApiTokenList } from '@/shared/api-sdk';

export const fetchUserApiTokensQuery = defineAuthFetcher<
  HttpRequestDTO<{ userId: string }>,
  ApiTokenList
>((http, request) =>
  http.request(getUserApiTokenControllerListUrl({ userId: request.params.userId }), {
    method: 'GET',
  }),
);
