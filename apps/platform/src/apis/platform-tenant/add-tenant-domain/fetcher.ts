import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getPlatformTenantControllerAddDomainUrl } from '@/shared/api-sdk';
import type { AddTenantDomainRequest, PlatformTenant } from '@/shared/api-sdk';

export const fetchAddTenantDomainMutation = defineAuthFetcher<
  HttpRequestDTO<{ id: string; body: AddTenantDomainRequest }>,
  PlatformTenant
>((http, request) =>
  http.request(
    getPlatformTenantControllerAddDomainUrl({ id: request.params.id }),
    jsonBody(request.params.body, { method: 'POST' }),
  ),
);
