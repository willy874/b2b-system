import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
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
