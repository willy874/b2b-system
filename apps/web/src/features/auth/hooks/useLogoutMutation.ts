import { useMutation } from '@tanstack/react-query';

import { getLogoutMutationOptions } from '@/apis/auth/logout/mutation';
import { sessionStore } from '@/core/auth';

export function useLogoutMutation() {
  return useMutation({
    ...getLogoutMutationOptions(),
    onSettled: () => {
      // 後端失敗也要在前端結束 session（使用者按了登出就是要離開）
      sessionStore.endSession('logout');
    },
  });
}
