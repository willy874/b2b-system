import { Button } from '@b2b-system/ui/Button';
import { Link } from '@b2b-system/ui/Link';
import { endSessionUrlOf, LOGOUT_INCOMPLETE } from '@b2b-system/web-core/auth';
import { useErrorMessage } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useEffect, useState } from 'react';

import { useRetryLogoutMutation } from '../../hooks/useRetryLogoutMutation';
import { LoginRoute } from '../../routes';
import { sessionEndMessageKey } from '../../sessionEnd';
import { SSO_CLIENT, startSsoLogin } from '../../sso';
import { AuthShell } from '../AuthShell';

/**
 * 登入改由 apps/platform 的 IdP 處理（docs/architecture/04-sso.md §12）：這一頁只負責頂層跳轉過去。
 * 剛登出時不自動跳轉：單一登出的請求可能還沒完成，自動跳過去會被尚未銷毀的 IdP session 直接登回來。
 * session 不是使用者自己結束的（逾時、帳號停用、憑證重用、密碼已變更…）時，說明原因（`?reason=`）。
 * 伺服器端的登出沒有完成（`?logout=incomplete`）時顯示警示與「重試登出」；重試仍失敗再提供 IdP 的 end-session 連結（§3.4）。
 */
export default function LoginPage() {
  const { t } = useTranslation();
  const { redirect, signedOut, reason, logout } = LoginRoute.useSearch();
  const navigate = LoginRoute.useNavigate();
  const toMessage = useErrorMessage();
  const retryLogout = useRetryLogoutMutation();
  // 跳轉前失敗（例：租戶停用、網址打錯 → get-current-tenant 回 503／404）：留著錯誤，render 時才翻譯
  const [failure, setFailure] = useState<{ error: unknown }>();
  const logoutIncomplete = logout === LOGOUT_INCOMPLETE;

  const start = () => {
    setFailure(undefined);
    startSsoLogin(redirect).catch((error: unknown) => setFailure({ error }));
  };

  const retry = () =>
    retryLogout.mutate(undefined, {
      // 完成了：回到一般的「已登出」說明
      onSuccess: () =>
        void navigate({
          search: (previous) => ({ ...previous, logout: undefined }),
          replace: true,
        }),
    });

  useEffect(() => {
    if (!signedOut) startSsoLogin(redirect).catch((error: unknown) => setFailure({ error }));
  }, [redirect, signedOut]);

  return (
    <AuthShell
      title={t('auth.login.title')}
      description={
        failure || logoutIncomplete
          ? undefined
          : signedOut
            ? t(sessionEndMessageKey(reason))
            : t('auth.login.redirecting')
      }
    >
      {logoutIncomplete && (
        <div
          className="m-0 mb-3 rounded-[var(--radius-md)] border border-[var(--color-warning)] px-3 py-2 text-sm"
          role="alert"
          data-testid="logout-incomplete"
        >
          <p className="m-0">{t('auth.login.logoutIncomplete')}</p>
          {retryLogout.isError && (
            <p
              className="mt-2 mb-0 text-[var(--color-danger-text)]"
              data-testid="logout-retry-error"
            >
              {toMessage(retryLogout.error)}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              onClick={retry}
              loading={retryLogout.isPending}
              data-testid="logout-retry"
            >
              {t('auth.login.retryLogout')}
            </Button>
            {retryLogout.isError && (
              <Link
                href={endSessionUrlOf(SSO_CLIENT, '/auth/login')}
                data-testid="logout-end-idp-session"
              >
                {t('auth.login.endIdpSession')}
              </Link>
            )}
          </div>
        </div>
      )}
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
