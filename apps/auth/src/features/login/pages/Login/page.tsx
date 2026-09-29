import { useEffect, useState } from 'react';

import { Button } from '@/components/Button';
import { useTranslation } from '@/core/locales';

import { LoginRoute } from '../../routes';
import { startSsoLogin } from '../../sso';
import { AuthShell } from '../AuthShell';

/**
 * 登入改由 apps/auth 的 IdP 處理（docs/adr/0019-sso-identity-platform.md）：這一頁只負責頂層跳轉過去。
 * 剛登出時不自動跳轉：單一登出的請求可能還沒完成，自動跳過去會被尚未銷毀的 IdP session 直接登回來。
 */
export default function LoginPage() {
  const { t } = useTranslation();
  const { redirect, signedOut } = LoginRoute.useSearch();
  const [failed, setFailed] = useState(false);

  const start = () => {
    setFailed(false);
    startSsoLogin(redirect).catch(() => setFailed(true));
  };

  useEffect(() => {
    if (!signedOut) startSsoLogin(redirect).catch(() => setFailed(true));
  }, [redirect, signedOut]);

  return (
    <AuthShell
      title={t('login.title')}
      description={signedOut ? t('login.signedOut') : t('login.redirecting')}
    >
      {(signedOut || failed) && (
        <Button variant="primary" block onClick={start} data-testid="login-sso">
          {t('login.submit')}
        </Button>
      )}
    </AuthShell>
  );
}
