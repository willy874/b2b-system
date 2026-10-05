import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

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
