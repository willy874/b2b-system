import { defineBaseFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getSsoInteractionControllerLoginUrl } from '@/shared/api-sdk';
import type { LoginRequest, SsoLoginResult } from '@/shared/api-sdk';

/**
 * 密碼登入；不需要 MFA 時回傳要 **頂層跳轉** 的 resume 網址（不用 fetch 跟隨：那樣 IdP session cookie 設不起來），
 * 需要時回傳下一步（`next`，docs/architecture/backend/21-mfa.md §4）。
 */
export const fetchLoginSsoInteractionMutation = defineBaseFetcher<
  HttpRequestDTO<LoginRequest & { uid: string }>,
  SsoLoginResult
>((http, { params: { uid, ...body } }) =>
  http.request(getSsoInteractionControllerLoginUrl({ uid }), jsonBody(body, { method: 'POST' })),
);
