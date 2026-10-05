import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getPermissionControllerListUrl } from '@/shared/api-sdk';
import type { PermissionCatalog } from '@/shared/api-sdk';

export const fetchPermissionListQuery = defineAuthFetcher<HttpRequestDTO<void>, PermissionCatalog>(
  (http) => http.request(getPermissionControllerListUrl(), { method: 'GET' }),
);
