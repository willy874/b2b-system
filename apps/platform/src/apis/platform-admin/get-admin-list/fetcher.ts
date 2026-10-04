import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getPlatformAdminControllerListUrl } from '@/shared/api-sdk';
import type { PlatformAdminList } from '@/shared/api-sdk';

export const fetchAdminListQuery = defineAuthFetcher<HttpRequestDTO<void>, PlatformAdminList>(
  (http) => http.request(getPlatformAdminControllerListUrl(), { method: 'GET' }),
);
