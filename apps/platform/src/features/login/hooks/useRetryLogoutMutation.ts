import { useMutation } from '@tanstack/react-query';

import { getLogoutMutationOptions } from '@/apis/auth/logout/mutation';

/**
 * 已登出頁的「重試登出」：前端 session 已經結束、手上沒有 token，以 refresh cookie 撤銷
 * （後端要求 `x-refresh-request: 1`，docs/architecture/04-sso.md §3.4）。
 */
export function useRetryLogoutMutation() {
  const { mutationFn: revoke } = getLogoutMutationOptions();
  return useMutation({ mutationFn: () => revoke({}) });
}
