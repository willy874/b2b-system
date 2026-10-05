import { sessionStore } from '@b2b-system/web-core/auth';
import { queryClient } from '@b2b-system/web-core/cache';
import { useMutation } from '@tanstack/react-query';

import { getSsoCallbackMutationOptions } from '@/apis/auth/sso-callback/mutation';

/** callback：授權碼換 app session，成功後寫進 session store（同密碼登入）。錯誤交給頁面顯示。 */
export function useSsoCallbackMutation() {
  return useMutation({
    ...getSsoCallbackMutationOptions(),
    onSuccess: (session) => {
      sessionStore.setTokens({ accessToken: session.accessToken, expiresIn: session.expiresIn });
      // 上一個人的快取不能留給下一個人
      queryClient.clear();
    },
  });
}
