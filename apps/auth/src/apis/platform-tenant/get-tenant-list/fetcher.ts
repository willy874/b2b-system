import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getPlatformTenantControllerListUrl } from '@/shared/api-sdk';
import type { PlatformTenantList } from '@/shared/api-sdk';

export const fetchTenantListQuery = defineAuthFetcher<HttpRequestDTO<void>, PlatformTenantList>(
  (http) => http.request(getPlatformTenantControllerListUrl(), { method: 'GET' }),
);
