import { useMutation } from '@tanstack/react-query';

import { getLogoutMutationOptions } from '@/apis/auth/logout/mutation';
import { sessionStore } from '@/core/auth';

import { LOGOUT_REASON } from '../sessionEnd';

/**
 * 順序很重要（先結束前端、再撤銷後端）：
 * 1. 等手上的續期結束，取得目前的 token（不這樣做，晚回來的續期會把登出的頁面救活）
 * 2. 結束前端 session：中止帶身分的請求、清掉 token、通知其他分頁、導回登入頁
 * 3. 用第 1 步的 token 通知後端撤銷整條 refresh token 家族
 */
export function useLogoutMutation() {
  const { mutationFn: revoke } = getLogoutMutationOptions();
  return useMutation({
    mutationFn: async () => {
      // 續期暫時失敗也要登出（使用者按了登出就是要離開）；只是後端無法撤銷
      const accessToken = await sessionStore.ensureAccessToken().catch(() => undefined);
      sessionStore.endSession(LOGOUT_REASON);
      if (accessToken) await revoke({ accessToken });
    },
  });
}
