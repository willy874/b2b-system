import { Outlet, useRouterState } from '@tanstack/react-router';
import { Suspense } from 'react';

import { ForbiddenPage, PageSkeleton } from '@/core/components';
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
  const matcher = matchers.find((candidate) => matches(pathname, candidate));
  const Shell = matcher?.component;

  const content = !gated ? (
    <Outlet />
  ) : !hydrated ? (
    <PageSkeleton />
  ) : canAccess ? (
    <Outlet />
  ) : (
    <ForbiddenPage />
  );

  const wrapped = <Suspense fallback={<PageSkeleton />}>{content}</Suspense>;
  return Shell ? <Shell>{wrapped}</Shell> : wrapped;
}
