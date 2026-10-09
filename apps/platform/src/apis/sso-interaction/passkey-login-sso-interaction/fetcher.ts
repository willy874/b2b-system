import { defineBaseFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getSsoInteractionControllerPasskeyLoginUrl } from '@/shared/api-sdk';
import type { SsoPasskeyLoginRequest, SsoRedirect } from '@/shared/api-sdk';

/** 以通行金鑰登入：回傳 resume 網址，由頁面 **頂層跳轉**（docs/architecture/04-sso.md §3.6）。 */
export const fetchPasskeyLoginSsoInteractionMutation = defineBaseFetcher<
  HttpRequestDTO<SsoPasskeyLoginRequest & { uid: string }>,
  SsoRedirect
>((http, { params: { uid, ...body } }) =>
  http.request(
    getSsoInteractionControllerPasskeyLoginUrl({ uid }),
    jsonBody(body, { method: 'POST' }),
  ),
);
