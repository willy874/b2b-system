import { defineBaseFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getAuthControllerSsoCallbackUrl } from '@/shared/api-sdk';
import type { Session, SsoCallbackRequest } from '@/shared/api-sdk';

/** 產品的 BFF：授權碼 ＋ PKCE verifier 換 app session。還沒有 session，所以用 base fetcher。 */
export const fetchSsoCallbackMutation = defineBaseFetcher<
  HttpRequestDTO<SsoCallbackRequest>,
  Session
>((http, request) =>
  http.request(getAuthControllerSsoCallbackUrl(), jsonBody(request.params, { method: 'POST' })),
);
