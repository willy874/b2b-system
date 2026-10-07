import { useMutation, useQuery } from '@tanstack/react-query';

import { getAbortSsoInteractionMutationOptions } from '@/apis/sso-interaction/abort-sso-interaction/mutation';
import { getSsoDiscoveryQueryOptions } from '@/apis/sso-interaction/discover-sso-interaction/query';
import { getSsoInteractionQueryOptions } from '@/apis/sso-interaction/get-sso-interaction/query';
import { getLoginSsoInteractionMutationOptions } from '@/apis/sso-interaction/login-sso-interaction/mutation';
import { getStartExternalSsoInteractionMutationOptions } from '@/apis/sso-interaction/start-external-sso-interaction/mutation';

/** IdP 的登入互動：成功後 **頂層跳轉** 到 provider 的 resume 網址，provider 再帶授權碼跳回產品。 */
export function followRedirect({ redirectTo }: { redirectTo: string }): void {
  globalThis.location.assign(redirectTo);
}

export function useSsoInteraction(uid: string) {
  return useQuery(getSsoInteractionQueryOptions(uid));
}

/**
 * 錯誤不在這裡吞掉：由登入表單顯示（例：AUTH_INVALID_CREDENTIALS、AUTH_ACCOUNT_LOCKED）。
 * 需要 MFA 時回應是下一步（`next`）而不是 resume 網址：由呼叫端切到第二步（docs/architecture/backend/21-mfa.md §4）。
 */
export function useSsoInteractionLoginMutation() {
  return useMutation({
    ...getLoginSsoInteractionMutationOptions(),
    onSuccess: (result) => {
      if ('redirectTo' in result) followRedirect(result);
    },
  });
}

export function useSsoInteractionAbortMutation() {
  return useMutation({ ...getAbortSsoInteractionMutationOptions(), onSuccess: followRedirect });
}

/**
 * email 網域對應的外部 IdP 連線（docs/architecture/04-sso.md §12.2 D9）。`email` 不是完整的 email 時不查詢；
 * 查詢失敗當成沒有連線（使用者仍可用密碼登入，只允許 SSO 的網域由後端擋下）。
 */
export function useSsoDiscovery(uid: string, email: string | undefined) {
  return useQuery({
    ...getSsoDiscoveryQueryOptions(uid, email ?? ''),
    enabled: Boolean(email),
  });
}

/** 以外部 IdP 登入：頂層跳轉到外部 IdP，登入後它跳回 api 的固定 callback。 */
export function useStartExternalLoginMutation() {
  return useMutation({
    ...getStartExternalSsoInteractionMutationOptions(),
    onSuccess: followRedirect,
  });
}
