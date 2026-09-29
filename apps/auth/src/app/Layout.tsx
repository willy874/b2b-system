import { Outlet, useRouterState } from '@tanstack/react-router';
import { Suspense } from 'react';

import { useTranslation } from '@/core/locales';
import { usePageAccess } from '@/core/permission';

import { PlatformLayout } from './layouts/PlatformLayout';

/** 不套平台外框的頁面：登入頁自己置中顯示。 */
const BARE_PREFIXES = ['/login'];

function PageFallback() {
  return <div className="p-6 text-sm text-[var(--color-fg-muted)]" aria-busy="true" />;
}

function Forbidden() {
  const { t } = useTranslation();
  return (
    <div className="p-6" data-testid="forbidden-page">
      <h1 className="m-0 text-lg font-semibold">{t('error.page.forbidden.title')}</h1>
      <p className="mt-2 text-sm text-[var(--color-fg-muted)]">
        {t('error.page.forbidden.description')}
      </p>
    </div>
  );
}

/**
 * 權限守衛在 Layout 而不在每個 route 的 beforeLoad（同 apps/backstage）：
 * 權限集合是非同步水合的，且 403 應該是頁面內容而不是導向。
 */
export function Layout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { hydrated, gated, canAccess } = usePageAccess(pathname);
  const bare = BARE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  const content = !gated ? (
    <Outlet />
  ) : !hydrated ? (
    <PageFallback />
  ) : canAccess ? (
    <Outlet />
  ) : (
    <Forbidden />
  );

  const wrapped = <Suspense fallback={<PageFallback />}>{content}</Suspense>;
  return bare ? wrapped : <PlatformLayout>{wrapped}</PlatformLayout>;
}
