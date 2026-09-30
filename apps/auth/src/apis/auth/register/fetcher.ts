import { defineBaseFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getAuthControllerRegisterUrl } from '@/shared/api-sdk';
import type { RegisterRequest, RegisterResult } from '@/shared/api-sdk';

/** 未登入即可呼叫：用不帶 token 的 base fetcher。 */
import { tenantHeaders } from '../tenant';
import type { TenantScoped } from '../tenant';

export const fetchRegisterMutation = defineBaseFetcher<
  HttpRequestDTO<RegisterRequest & TenantScoped>,
  RegisterResult
>((http, request) => {
  const { tenant, ...body } = request.params;
  return http.request(
    getAuthControllerRegisterUrl(),
    jsonBody(body, { method: 'POST', headers: tenantHeaders(tenant) }),
  );
});
