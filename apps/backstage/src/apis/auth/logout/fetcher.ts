import type { RevokeSessionRequest } from '@b2b-system/web-core/auth';
import { defineBaseFetcher } from '@b2b-system/web-core/client';

import { getAuthControllerLogoutUrl } from '@/shared/api-sdk';

/** 有 `accessToken` 時以 bearer 登出；沒有（續期失敗、已登出頁的「重試登出」）時以 refresh cookie 登出。 */
export type LogoutRequest = RevokeSessionRequest;

/**
 * 走 base 管道並自帶 token：登出時前端 session 已先結束，auth 管道拿不到 token，
 * 而且 session 結束會中止 auth 管道上的請求。
 * 沒有 token 時改帶 `x-refresh-request: 1`，後端以 refresh cookie 認人（CSRF 緩解，同續期；docs/architecture/04-sso.md §3.4）。
 * `keepalive`：按完登出立刻關分頁，請求仍會送完，不會留下沒撤銷的 IdP session。
 */
export const fetchLogoutMutation = defineBaseFetcher<LogoutRequest, { success: boolean }>(
  (http, { accessToken }) =>
    http.request(getAuthControllerLogoutUrl(), {
      method: 'POST',
      headers: accessToken
        ? { authorization: `Bearer ${accessToken}` }
        : { 'x-refresh-request': '1' },
      credentials: 'same-origin',
      keepalive: true,
    }),
);
