import { defineBaseFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getPlatformAuthControllerSsoCallbackUrl } from '@/shared/api-sdk';
import type { Session, SsoCallbackRequest } from '@/shared/api-sdk';

/** 產品的 BFF：授權碼 ＋ PKCE verifier 換 app session。還沒有 session，所以用 base fetcher。 */
export const fetchSsoCallbackMutation = defineBaseFetcher<
  HttpRequestDTO<SsoCallbackRequest>,
  Session
>((http, request) =>
  http.request(
    getPlatformAuthControllerSsoCallbackUrl(),
    jsonBody(request.params, { method: 'POST' }),
  ),
);
