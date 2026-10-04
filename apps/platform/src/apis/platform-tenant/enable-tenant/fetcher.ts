import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getPlatformTenantControllerEnableUrl } from '@/shared/api-sdk';
import type { PlatformTenant } from '@/shared/api-sdk';

export const fetchEnableTenantMutation = defineAuthFetcher<
  HttpRequestDTO<{ id: string }>,
  PlatformTenant
>((http, request) =>
  http.request(getPlatformTenantControllerEnableUrl({ id: request.params.id }), { method: 'POST' }),
);
