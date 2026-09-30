import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getPlatformTenantControllerRemoveDomainUrl } from '@/shared/api-sdk';
import type { PlatformTenant } from '@/shared/api-sdk';

export const fetchRemoveTenantDomainMutation = defineAuthFetcher<
  HttpRequestDTO<{ id: string; domain: string }>,
  PlatformTenant
>((http, request) =>
  http.request(getPlatformTenantControllerRemoveDomainUrl(request.params), { method: 'DELETE' }),
);
