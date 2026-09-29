import { defineBaseFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getAuthControllerLoginUrl } from '@/shared/api-sdk';
import type { LoginRequest, Session } from '@/shared/api-sdk';

/** 登入必須用 base fetcher：auth 版會先嘗試取得 access token 而死結。 */
export const fetchLoginMutation = defineBaseFetcher<HttpRequestDTO<LoginRequest>, Session>(
  (http, request) =>
    http.request(getAuthControllerLoginUrl(), jsonBody(request.params, { method: 'POST' })),
);
