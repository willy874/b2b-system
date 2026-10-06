import { useHasSession } from '@b2b-system/web-core/auth';
import { useQuery } from '@tanstack/react-query';
import { Outlet, useRouterState } from '@tanstack/react-router';
import { Suspense } from 'react';

import { getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';
import { usePageAccess } from '@/core/permission';

import { ForbiddenPage, PageFallback, UnexpectedErrorPage } from './ErrorPages';
import { DashboardLayout } from './layouts';

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
  '/enter',
];

/**
 * 權限守衛在 Layout 而不在每個 route 的 beforeLoad（同 apps/backstage）：
 * 權限集合是非同步水合的，且 403 應該是頁面內容而不是導向。
 */
export function Layout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { hydrated, gated, canAccess } = usePageAccess(pathname);
  // 與 useSyncPermissions 同一個 query（共用快取，不會多打一次）：只拿來判斷水合是否失敗
  const hasSession = useHasSession();
  const profile = useQuery({ ...getAuthProfileQueryOptions(), enabled: hasSession });
  const bare = BARE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  const content = !gated ? (
    <Outlet />
  ) : !hydrated ? (
    // profile 失敗（5xx、逾時）時權限永遠不會水合：說明原因並提供重試，不要一直轉圈
    profile.isError ? (
      <UnexpectedErrorPage error={profile.error} onRetry={() => void profile.refetch()} />
    ) : (
      <PageFallback />
    )
  ) : canAccess ? (
    <Outlet />
  ) : (
    <ForbiddenPage />
  );

  const wrapped = <Suspense fallback={<PageFallback />}>{content}</Suspense>;
  return bare ? wrapped : <DashboardLayout>{wrapped}</DashboardLayout>;
}
