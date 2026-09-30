import { Outlet, useRouterState } from '@tanstack/react-router';
import { Suspense } from 'react';

import { usePageAccess } from '@/core/permission';

import { ForbiddenPage, PageFallback } from './ErrorPages';
import { PlatformLayout } from './layouts/PlatformLayout';

/** 不套平台外框的頁面：登入相關的頁面自己置中顯示。 */
const BARE_PREFIXES = [
  '/login',
  '/callback',
  '/interaction',
  '/error',
  '/forgot-password',
  '/reset-password',
  '/setup',
  '/register',
];

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
    <ForbiddenPage />
  );

  const wrapped = <Suspense fallback={<PageFallback />}>{content}</Suspense>;
  return bare ? wrapped : <PlatformLayout>{wrapped}</PlatformLayout>;
}
