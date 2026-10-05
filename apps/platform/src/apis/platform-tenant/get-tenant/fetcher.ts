import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getPlatformTenantControllerGetUrl } from '@/shared/api-sdk';
import type { PlatformTenant } from '@/shared/api-sdk';

export const fetchTenantQuery = defineAuthFetcher<HttpRequestDTO<{ id: string }>, PlatformTenant>(
  (http, request) =>
    http.request(getPlatformTenantControllerGetUrl({ id: request.params.id }), { method: 'GET' }),
);
