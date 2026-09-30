import { defineBaseFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getSsoInteractionControllerDetailsUrl } from '@/shared/api-sdk';
import type { SsoInteraction } from '@/shared/api-sdk';

/**
 * 登入互動的資訊。公開端點：憑證是 provider 設在 `/api/oidc-interaction/:uid` 的互動 cookie，
 * 同 origin 的 fetch 會自動帶上（docs/adr/0019-sso-identity-platform.md）。
 */
export const fetchSsoInteractionQuery = defineBaseFetcher<
  HttpRequestDTO<{ uid: string }>,
  SsoInteraction
>((http, request) =>
  http.request(getSsoInteractionControllerDetailsUrl({ uid: request.params.uid }), {
    method: 'GET',
  }),
);
