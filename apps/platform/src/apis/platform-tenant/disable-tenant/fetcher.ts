import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getPlatformTenantControllerDisableUrl } from '@/shared/api-sdk';
import type { PlatformTenant } from '@/shared/api-sdk';

/** 停用：網域回 503，撤銷該租戶所有 session。 */
export const fetchDisableTenantMutation = defineAuthFetcher<
  HttpRequestDTO<{ id: string }>,
  PlatformTenant
>((http, request) =>
  http.request(getPlatformTenantControllerDisableUrl({ id: request.params.id }), {
    method: 'POST',
  }),
);
