import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getPlatformTenantControllerGetUrl } from '@/shared/api-sdk';
import type { PlatformTenant } from '@/shared/api-sdk';

export const fetchTenantQuery = defineAuthFetcher<HttpRequestDTO<{ id: string }>, PlatformTenant>(
  (http, request) =>
    http.request(getPlatformTenantControllerGetUrl({ id: request.params.id }), { method: 'GET' }),
);
