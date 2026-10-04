import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getPlatformTenantControllerUpdateUrl } from '@/shared/api-sdk';
import type { PlatformTenant, UpdateTenantRequest } from '@/shared/api-sdk';

export const fetchUpdateTenantMutation = defineAuthFetcher<
  HttpRequestDTO<{ id: string; body: UpdateTenantRequest }>,
  PlatformTenant
>((http, request) =>
  http.request(
    getPlatformTenantControllerUpdateUrl({ id: request.params.id }),
    jsonBody(request.params.body, { method: 'PATCH' }),
  ),
);
