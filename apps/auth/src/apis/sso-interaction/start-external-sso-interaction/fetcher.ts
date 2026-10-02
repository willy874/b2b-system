import { defineBaseFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getSsoInteractionControllerStartExternalUrl } from '@/shared/api-sdk';
import type { SsoRedirect, StartExternalLoginRequest } from '@/shared/api-sdk';

/** 以外部 IdP 登入；回傳外部 IdP 的授權網址，由頁面 **頂層跳轉** 過去（docs/architecture/04-sso.md §12.2 D6）。 */
export const fetchStartExternalSsoInteractionMutation = defineBaseFetcher<
  HttpRequestDTO<StartExternalLoginRequest & { uid: string }>,
  SsoRedirect
>((http, { params: { uid, ...body } }) =>
  http.request(
    getSsoInteractionControllerStartExternalUrl({ uid }),
    jsonBody(body, { method: 'POST' }),
  ),
);
