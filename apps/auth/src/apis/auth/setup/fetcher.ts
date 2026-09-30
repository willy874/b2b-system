import { defineBaseFetcher, jsonBody, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import {
  getAuthControllerSetupUrl,
  getAuthControllerVerifySetupUrl,
  getPlatformAuthControllerSetupUrl,
  getPlatformAuthControllerVerifySetupUrl,
} from '@/shared/api-sdk';
import type { SetupRequest } from '@/shared/api-sdk';

import { tenantHeaders } from '../tenant';
import type { MaybeTenantScoped } from '../tenant';

/** 有租戶：租戶帳號的啟用（`X-Tenant`）；沒有：平台管理者的啟用。 */
export const fetchSetupMutation = defineBaseFetcher<
  HttpRequestDTO<SetupRequest & MaybeTenantScoped>,
  { success: boolean }
>((http, request) => {
  const { tenant, ...body } = request.params;
  return tenant
    ? http.request(
        getAuthControllerSetupUrl(),
        jsonBody(body, { method: 'POST', headers: tenantHeaders(tenant) }),
      )
    : http.request(getPlatformAuthControllerSetupUrl(), jsonBody(body, { method: 'POST' }));
});

export const fetchVerifySetupQuery = defineBaseFetcher<
  HttpRequestDTO<{ token: string } & MaybeTenantScoped>,
  { valid: boolean; email?: string }
>((http, request) => {
  const { tenant, token } = request.params;
  return tenant
    ? http.request(withQuery(getAuthControllerVerifySetupUrl(), { token }), {
        method: 'GET',
        headers: tenantHeaders(tenant),
      })
    : http.request(withQuery(getPlatformAuthControllerVerifySetupUrl(), { token }), {
        method: 'GET',
      });
});
