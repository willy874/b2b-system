import { defineBaseFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getAuthControllerResetPasswordUrl } from '@/shared/api-sdk';
import type { ResetPasswordRequest } from '@/shared/api-sdk';

import { tenantHeaders } from '../tenant';
import type { TenantScoped } from '../tenant';

export const fetchResetPasswordMutation = defineBaseFetcher<
  HttpRequestDTO<ResetPasswordRequest & TenantScoped>,
  { success: boolean }
>((http, request) => {
  const { tenant, ...body } = request.params;
  return http.request(
    getAuthControllerResetPasswordUrl(),
    jsonBody(body, { method: 'POST', headers: tenantHeaders(tenant) }),
  );
});
