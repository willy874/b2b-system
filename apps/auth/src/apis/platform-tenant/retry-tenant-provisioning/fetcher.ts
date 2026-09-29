import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getPlatformTenantControllerRetryProvisioningUrl } from '@/shared/api-sdk';
import type { PlatformTenant } from '@/shared/api-sdk';

export const fetchRetryTenantProvisioningMutation = defineAuthFetcher<
  HttpRequestDTO<{ id: string }>,
  PlatformTenant
>((http, request) =>
  http.request(getPlatformTenantControllerRetryProvisioningUrl({ id: request.params.id }), {
    method: 'POST',
  }),
);
