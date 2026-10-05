import { defineBaseFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getSsoInteractionControllerLoginUrl } from '@/shared/api-sdk';
import type { LoginRequest, SsoRedirect } from '@/shared/api-sdk';

/** 密碼登入；回傳要 **頂層跳轉** 的 resume 網址（不用 fetch 跟隨：那樣 IdP session cookie 設不起來）。 */
export const fetchLoginSsoInteractionMutation = defineBaseFetcher<
  HttpRequestDTO<LoginRequest & { uid: string }>,
  SsoRedirect
>((http, { params: { uid, ...body } }) =>
  http.request(getSsoInteractionControllerLoginUrl({ uid }), jsonBody(body, { method: 'POST' })),
);
