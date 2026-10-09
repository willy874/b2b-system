import { isAppError, useErrorMessage } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { authenticatePasskey, ceremonyErrorKey } from '@b2b-system/web-core/mfa';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { getPasskeyLoginSsoInteractionMutationOptions } from '@/apis/sso-interaction/passkey-login-sso-interaction/mutation';
import { getPasskeyOptionsSsoInteractionMutationOptions } from '@/apis/sso-interaction/passkey-options-sso-interaction/mutation';

import type { InteractionFormError } from './useInteractionLogin';
import { followRedirect } from './useSsoInteraction';

/**
 * 以通行金鑰取代密碼登入（docs/architecture/04-sso.md §3.6）：按下時向伺服器取 challenge、呼叫瀏覽器 API
 * （列出這個網域的通行金鑰）、把回應交給伺服器，成功後頂層跳轉到 resume 網址。
 * 使用者取消或瀏覽器拒絕時顯示原因，可以再按一次（每次都換新的 challenge）。
 */
export function usePasskeyLogin(uid: string) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const options = useMutation(getPasskeyOptionsSsoInteractionMutationOptions());
  const login = useMutation({
    ...getPasskeyLoginSsoInteractionMutationOptions(),
    onSuccess: followRedirect,
  });
  const [error, setError] = useState<InteractionFormError>();
  const [ceremony, setCeremony] = useState(false);

  const start = async () => {
    setError(undefined);
    let response: unknown;
    try {
      const { publicData } = await options.mutateAsync({ params: { uid } });
      setCeremony(true);
      response = await authenticatePasskey(publicData.options);
    } catch (cause) {
      setCeremony(false);
      setError(
        isAppError(cause)
          ? { message: toMessage(cause), code: cause.code }
          : { message: t(ceremonyErrorKey(cause)) },
      );
      return;
    }
    setCeremony(false);
    try {
      await login.mutateAsync({ params: { uid, payload: { response } } });
    } catch (cause) {
      setError({ message: toMessage(cause), code: isAppError(cause) ? cause.code : undefined });
    }
  };

  return {
    start,
    error,
    /** 取 challenge、等瀏覽器、送出或已經在跳轉 */
    pending: options.isPending || ceremony || login.isPending || login.isSuccess,
  };
}
