import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getPermissionControllerListUrl } from '@/shared/api-sdk';
import type { PermissionCatalog } from '@/shared/api-sdk';

export const fetchPermissionListQuery = defineAuthFetcher<HttpRequestDTO<void>, PermissionCatalog>(
  (http) => http.request(getPermissionControllerListUrl(), { method: 'GET' }),
);
