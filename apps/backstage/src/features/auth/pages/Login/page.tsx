import { useEffect, useState } from 'react';

import { Button } from '@/components/Button';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';

import { LoginRoute } from '../../routes';
import { sessionEndMessageKey } from '../../sessionEnd';
import { startSsoLogin } from '../../sso';
import { AuthShell } from '../AuthShell';

/**
 * 登入改由 apps/auth 的 IdP 處理（docs/adr/0019-sso-identity-platform.md）：這一頁只負責頂層跳轉過去。
 * 剛登出時不自動跳轉：單一登出的請求可能還沒完成，自動跳過去會被尚未銷毀的 IdP session 直接登回來。
 * session 不是使用者自己結束的（逾時、帳號停用、憑證重用、密碼已變更…）時，說明原因（`?reason=`）。
 */
export default function LoginPage() {
  const { t } = useTranslation();
  const { redirect, signedOut, reason } = LoginRoute.useSearch();
  const toMessage = useErrorMessage();
  // 跳轉前失敗（例：租戶停用、網址打錯 → get-current-tenant 回 503／404）：留著錯誤，render 時才翻譯
  const [failure, setFailure] = useState<{ error: unknown }>();

  const start = () => {
    setFailure(undefined);
    startSsoLogin(redirect).catch((error: unknown) => setFailure({ error }));
  };

  useEffect(() => {
    if (!signedOut) startSsoLogin(redirect).catch((error: unknown) => setFailure({ error }));
  }, [redirect, signedOut]);

  return (
    <AuthShell
      title={t('auth.login.title')}
      description={
        failure
          ? undefined
          : signedOut
            ? t(sessionEndMessageKey(reason))
            : t('auth.login.redirecting')
      }
    >
      {failure && (
        <p
          className="m-0 mb-3 text-sm text-[var(--color-danger-text)]"
          role="alert"
          data-testid="login-error"
        >
          {toMessage(failure.error)}
        </p>
      )}
      {(signedOut || failure) && (
        <Button variant="primary" block onClick={start} data-testid="login-sso">
          {t('auth.login.submit')}
        </Button>
      )}
    </AuthShell>
  );
}
