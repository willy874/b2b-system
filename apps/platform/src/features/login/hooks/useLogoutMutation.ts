import { LOGOUT_INCOMPLETE, signOut } from '@b2b-system/web-core/auth';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';

import { getLogoutMutationOptions } from '@/apis/auth/logout/mutation';

import { LOGOUT_REASON } from '../sessionEnd';

/**
 * 登出：先結束前端、再撤銷後端（web-core 的 `signOut`，docs/architecture/frontend/09-state-and-storage.md §5.2）。
 * 後端沒有完成撤銷（撤銷失敗，或續期失敗後以 refresh cookie 也失敗）時，IdP session 可能還在，下一個人打開產品會被直接登入：
 * 已登出頁加上 `logout=incomplete`，顯示警示與「重試登出」（docs/architecture/04-sso.md §3.4）。
 * 導覽在 mutationFn 裡做：session 結束後外框已經卸載，onError／onSuccess 不一定還會被呼叫。
 */
export function useLogoutMutation() {
  const { mutationFn: revoke } = getLogoutMutationOptions();
  const router = useRouter();
  return useMutation({
    mutationFn: async () => {
      if (await signOut({ reason: LOGOUT_REASON, revoke })) return;
      await router.navigate({
        to: '/login',
        search: (previous) => ({ ...previous, signedOut: true, logout: LOGOUT_INCOMPLETE }),
        replace: true,
        // session 已經結束，未儲存提醒留不住使用者（通常 SessionWatcher 已先導到登入頁）
        ignoreBlocker: true,
      });
    },
  });
}
