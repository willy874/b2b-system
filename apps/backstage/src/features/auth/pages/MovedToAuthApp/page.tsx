import { useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';

import { useTranslation } from '@/core/locales';
import { ENV } from '@/shared/constants';

import { AuthShell } from '../AuthShell';

/**
 * 帳號流程搬到 apps/auth 了（docs/adr/0019-sso-identity-platform.md D1）。這個頁面接住已寄出的信裡的舊連結
 * （`/auth/setup?token=…` 等），連同查詢字串頂層跳轉到 apps/auth 的同名頁面。保留一版後移除（docs/architecture/04-sso.md §6.1）。
 */
export default function MovedToAuthAppPage() {
  const { t } = useTranslation();
  const { pathname, searchStr } = useRouterState({ select: (state) => state.location });

  useEffect(() => {
    const path = pathname.replace(/^\/auth/, '');
    globalThis.location.replace(`${ENV.AUTH_APP_URL}${path}${searchStr}`);
  }, [pathname, searchStr]);

  return (
    <AuthShell title={t('auth.login.title')} description={t('auth.login.redirecting')}>
      {null}
    </AuthShell>
  );
}
