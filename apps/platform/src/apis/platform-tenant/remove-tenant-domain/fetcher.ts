import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getPlatformTenantControllerRemoveDomainUrl } from '@/shared/api-sdk';
import type { PlatformTenant } from '@/shared/api-sdk';

export const fetchRemoveTenantDomainMutation = defineAuthFetcher<
  HttpRequestDTO<{ id: string; domain: string }>,
  PlatformTenant
>((http, request) =>
  http.request(getPlatformTenantControllerRemoveDomainUrl(request.params), { method: 'DELETE' }),
);
