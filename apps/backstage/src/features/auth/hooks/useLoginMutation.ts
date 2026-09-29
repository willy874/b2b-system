import { useMutation } from '@tanstack/react-query';

import { getLoginMutationOptions } from '@/apis/auth/login/mutation';
import { sessionStore } from '@/core/auth';
import { queryClient } from '@/core/cache';

export function useLoginMutation() {
  return useMutation({
    ...getLoginMutationOptions(),
    onSuccess: (session) => {
      sessionStore.setTokens({ accessToken: session.accessToken, expiresIn: session.expiresIn });
      // 上一個人的快取不能留給下一個人
      queryClient.clear();
    },
  });
}
