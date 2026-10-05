import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

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
