import { defineBaseFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import {
  getAuthControllerResetPasswordUrl,
  getPlatformAuthControllerResetPasswordUrl,
} from '@/shared/api-sdk';
import type { ResetPasswordRequest } from '@/shared/api-sdk';

import { tenantHeaders } from '../tenant';
import type { MaybeTenantScoped } from '../tenant';

/** 有租戶：租戶帳號（`X-Tenant`）；沒有：平台管理者。 */
export const fetchResetPasswordMutation = defineBaseFetcher<
  HttpRequestDTO<ResetPasswordRequest & MaybeTenantScoped>,
  { success: boolean }
>((http, request) => {
  const { tenant, ...body } = request.params;
  return tenant
    ? http.request(
        getAuthControllerResetPasswordUrl(),
        jsonBody(body, { method: 'POST', headers: tenantHeaders(tenant) }),
      )
    : http.request(getPlatformAuthControllerResetPasswordUrl(), jsonBody(body, { method: 'POST' }));
});
