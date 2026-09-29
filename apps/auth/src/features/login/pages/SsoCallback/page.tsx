import { useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/Button';
import { discardPendingLogin, readPendingLogin } from '@/core/auth';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';

import { useSsoCallbackMutation } from '../../hooks/useSsoCallbackMutation';
import { SsoCallbackRoute } from '../../routes';
import { redirectUriOfClient, SSO_CLIENT, startSsoLogin } from '../../sso';
import { AuthShell } from '../AuthShell';

/**
 * IdP 帶授權碼跳回來：以 `state` 取回這個分頁存的 PKCE verifier，交給自己 origin 的 BFF 換 app session
 * （docs/adr/0019-sso-identity-platform.md D3）。授權碼只能兌換一次，所以同一次載入只送一次。
 */
export default function SsoCallbackPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { code, state, error } = SsoCallbackRoute.useSearch();
  const exchange = useSsoCallbackMutation();
  const toMessage = useErrorMessage();
  // render 時就判斷這次 callback 能不能兌換（讀取但不刪除 verifier，開始兌換時才刪）
  const [pending] = useState(() => readPendingLogin(state));
  const usable = Boolean(code && pending && !error);
  // 物件而不是字串：訊息可能是空字串（語系尚未載入），不能拿它判斷有沒有失敗
  const [exchangeFailure, setExchangeFailure] = useState<{ message: string }>();
  const sent = useRef(false);

  useEffect(() => {
    // StrictMode 的開發模式會執行 effect 兩次：第二次不再兌換（授權碼已經用掉）
    if (sent.current || !code || !pending || error) return;
    sent.current = true;
    discardPendingLogin(state);
    exchange
      .mutateAsync({
        params: {
          code,
          codeVerifier: pending.verifier,
          clientId: SSO_CLIENT.clientId,
          redirectUri: redirectUriOfClient(),
        },
      })
      // returnTo 可能帶查詢字串（例：接受邀請頁的 token），以網址直接換頁
      .then(() => router.history.replace(pending.returnTo))
      .catch((caught: unknown) => setExchangeFailure({ message: toMessage(caught) }));
  }, [code, error, exchange, pending, router, state, toMessage]);

  const failure = usable
    ? exchangeFailure
    : {
        message:
          error === 'access_denied' ? t('login.callback.cancelled') : t('login.callback.failed'),
      };

  return (
    <AuthShell
      title={t('login.callback.title')}
      description={failure?.message ?? t('login.callback.working')}
    >
      {failure && (
        <Button
          variant="primary"
          block
          onClick={() => void startSsoLogin(undefined)}
          data-testid="sso-callback-retry"
        >
          {t('login.submit')}
        </Button>
      )}
    </AuthShell>
  );
}
