import { defineBaseFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getAuthControllerForgotPasswordUrl } from '@/shared/api-sdk';
import type { ForgotPasswordRequest } from '@/shared/api-sdk';

import { tenantHeaders } from '../tenant';
import type { TenantScoped } from '../tenant';

export const fetchForgotPasswordMutation = defineBaseFetcher<
  HttpRequestDTO<ForgotPasswordRequest & TenantScoped>,
  { sent: boolean }
>((http, request) => {
  const { tenant, ...body } = request.params;
  return http.request(
    getAuthControllerForgotPasswordUrl(),
    jsonBody(body, { method: 'POST', headers: tenantHeaders(tenant) }),
  );
});
