import { defineBaseFetcher, jsonBody, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getAuthControllerSetupUrl, getAuthControllerVerifySetupUrl } from '@/shared/api-sdk';
import type { SetupRequest } from '@/shared/api-sdk';

import { tenantHeaders } from '../tenant';
import type { TenantScoped } from '../tenant';

export const fetchSetupMutation = defineBaseFetcher<
  HttpRequestDTO<SetupRequest & TenantScoped>,
  { success: boolean }
>((http, request) => {
  const { tenant, ...body } = request.params;
  return http.request(
    getAuthControllerSetupUrl(),
    jsonBody(body, { method: 'POST', headers: tenantHeaders(tenant) }),
  );
});

export const fetchVerifySetupQuery = defineBaseFetcher<
  HttpRequestDTO<{ token: string } & TenantScoped>,
  { valid: boolean; email?: string }
>((http, request) => {
  const { tenant, token } = request.params;
  return http.request(withQuery(getAuthControllerVerifySetupUrl(), { token }), {
    method: 'GET',
    headers: tenantHeaders(tenant),
  });
});
