import { defineBaseFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getAuthControllerRegisterUrl } from '@/shared/api-sdk';
import type { RegisterRequest, RegisterResult } from '@/shared/api-sdk';

/** 未登入即可呼叫：用不帶 token 的 base fetcher。 */
export const fetchRegisterMutation = defineBaseFetcher<
  HttpRequestDTO<RegisterRequest>,
  RegisterResult
>((http, request) =>
  http.request(getAuthControllerRegisterUrl(), jsonBody(request.params, { method: 'POST' })),
);
