import { useHasSession } from '@b2b-system/web-core/auth';
import {
  ForbiddenPage,
  NotFoundPage,
  PageSkeleton,
  UnexpectedErrorPage,
} from '@b2b-system/web-core/components';
import { useQuery } from '@tanstack/react-query';
import { Outlet, useRouterState } from '@tanstack/react-router';
import { Suspense } from 'react';

import { getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';
import { useFeatureGate } from '@/core/feature';
import { usePageAccess } from '@/core/permission';

import { DashboardLayout } from './layouts';

interface LayoutMatcher {
  component: (props: { children: React.ReactNode }) => React.ReactNode;
  includes: string[];
  excludes?: string[];
}

const matchers: LayoutMatcher[] = [
  { component: DashboardLayout, includes: ['/'], excludes: ['/auth'] },
];

function matches(pathname: string, matcher: LayoutMatcher): boolean {
  if (
    matcher.excludes?.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  ) {
    return false;
  }
  return matcher.includes.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

/**
 * 權限守衛在 Layout 而不在每個 route 的 beforeLoad：
 * 權限集合是非同步水合的，且 403 應該是頁面內容而不是導向。
 */
export function Layout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { hydrated, gated, canAccess } = usePageAccess(pathname);
  // 第二道防線（docs/architecture/frontend/02-plugin-system.md §9.2 D7）：可啟用 feature 的頁面在安裝前沒有權限註冊，
  // usePageAccess 會當成「不受管」而放行，所以先看 feature 的狀態
  const featureGate = useFeatureGate(pathname);
  // 與 useSyncPermissions 同一個 query（共用快取，不會多打一次）：只拿來判斷水合是否失敗
  const hasSession = useHasSession();
  const profile = useQuery({ ...getAuthProfileQueryOptions(), enabled: hasSession });
  const matcher = matchers.find((candidate) => matches(pathname, candidate));
  const Shell = matcher?.component;

  const content =
    featureGate === 'disabled' ? (
      <NotFoundPage />
    ) : featureGate === 'failed' ? (
      <UnexpectedErrorPage onRetry={() => globalThis.location.reload()} />
    ) : featureGate === 'pending' ? (
      // 啟用清單跟著 profile 來：profile 失敗時清單永遠不會到
      profile.isError ? (
        <UnexpectedErrorPage error={profile.error} onRetry={() => void profile.refetch()} />
      ) : (
        <PageSkeleton />
      )
    ) : !gated ? (
      <Outlet />
    ) : !hydrated ? (
      // profile 失敗（5xx、逾時、TENANT_UNAVAILABLE）時權限永遠不會水合：說明原因並提供重試，
      // 不要停在骨架屏
      profile.isError ? (
        <UnexpectedErrorPage error={profile.error} onRetry={() => void profile.refetch()} />
      ) : (
        <PageSkeleton />
      )
    ) : canAccess ? (
      <Outlet />
    ) : (
      <ForbiddenPage />
    );

  const wrapped = <Suspense fallback={<PageSkeleton />}>{content}</Suspense>;
  return Shell ? <Shell>{wrapped}</Shell> : wrapped;
}
