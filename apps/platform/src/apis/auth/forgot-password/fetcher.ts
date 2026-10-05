import { defineBaseFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

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
