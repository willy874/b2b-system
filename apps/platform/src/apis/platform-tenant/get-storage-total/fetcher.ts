import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getPlatformTenantControllerGetStorageTotalUrl } from '@/shared/api-sdk';
import type { StorageTotal } from '@/shared/api-sdk';

export const fetchStorageTotalQuery = defineAuthFetcher<HttpRequestDTO<void>, StorageTotal>(
  (http) => http.request(getPlatformTenantControllerGetStorageTotalUrl(), { method: 'GET' }),
);
