import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getPlatformTenantControllerCreateUrl } from '@/shared/api-sdk';
import type { CreateTenantRequest, PlatformTenant } from '@/shared/api-sdk';

/** 建立租戶：回應時還在佈建中（背景工作）。 */
export const fetchCreateTenantMutation = defineAuthFetcher<
  HttpRequestDTO<CreateTenantRequest>,
  PlatformTenant
>((http, request) =>
  http.request(
    getPlatformTenantControllerCreateUrl(),
    jsonBody(request.params, { method: 'POST' }),
  ),
);
