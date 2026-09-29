import { useMutation, useQuery } from '@tanstack/react-query';

import { getAbortSsoInteractionMutationOptions } from '@/apis/sso-interaction/abort-sso-interaction/mutation';
import { getSsoInteractionQueryOptions } from '@/apis/sso-interaction/get-sso-interaction/query';
import { getLoginSsoInteractionMutationOptions } from '@/apis/sso-interaction/login-sso-interaction/mutation';

/** IdP 的登入互動：成功後 **頂層跳轉** 到 provider 的 resume 網址，provider 再帶授權碼跳回產品。 */
function followRedirect({ redirectTo }: { redirectTo: string }): void {
  globalThis.location.assign(redirectTo);
}

export function useSsoInteraction(uid: string) {
  return useQuery(getSsoInteractionQueryOptions(uid));
}

/** 錯誤不在這裡吞掉：由登入表單顯示（例：AUTH_INVALID_CREDENTIALS、AUTH_ACCOUNT_LOCKED）。 */
export function useSsoInteractionLoginMutation() {
  return useMutation({ ...getLoginSsoInteractionMutationOptions(), onSuccess: followRedirect });
}

export function useSsoInteractionAbortMutation() {
  return useMutation({ ...getAbortSsoInteractionMutationOptions(), onSuccess: followRedirect });
}
