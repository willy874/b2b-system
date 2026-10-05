import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getApiTokenControllerListUrl } from '@/shared/api-sdk';
import type { ApiTokenList } from '@/shared/api-sdk';

export const fetchMyApiTokensQuery = defineAuthFetcher<HttpRequestDTO<void>, ApiTokenList>((http) =>
  http.request(getApiTokenControllerListUrl(), { method: 'GET' }),
);
