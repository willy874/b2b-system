import { defineBaseFetcher } from '@/core/client';
import { getAuthControllerLogoutUrl } from '@/shared/api-sdk';

export interface LogoutRequest {
  accessToken: string;
}

/**
 * 走 base 管道並自帶 token：登出時前端 session 已先結束，auth 管道拿不到 token，
 * 而且 session 結束會中止 auth 管道上的請求。
 */
export const fetchLogoutMutation = defineBaseFetcher<LogoutRequest, { success: boolean }>(
  (http, { accessToken }) =>
    http.request(getAuthControllerLogoutUrl(), {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      credentials: 'same-origin',
    }),
);
