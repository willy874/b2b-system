import { RouterProvider } from '@tanstack/react-router';
import { useEffect } from 'react';

import type { AppContext } from '@/core/app';
import { sessionStore, useHasSession } from '@/core/auth';
import { queryClient } from '@/core/cache';
import { usePermissionStore } from '@/core/store';
import { useSyncPermissions } from '@/features/login';

import { GlobalProvider } from './GlobalProvider';

/** 不需要 session 的頁面（登入、之後的 OIDC 互動頁與帳號流程）。 */
const PUBLIC_PREFIXES = ['/login'];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function SessionWatcher({ router }: { router: AppContext['router'] }) {
  // 整個 app 只有一個權限水合實例
  useSyncPermissions();
  const hasSession = useHasSession();

  // 完全沒有 session（例如直接貼受保護的網址）→ 導向登入頁並記住原本要去的地方
  useEffect(() => {
    if (hasSession) return;
    const pathname = globalThis.location.pathname;
    if (isPublic(pathname)) return;
    void router.navigate({ to: '/login', search: { redirect: pathname }, replace: true });
  }, [hasSession, router]);

  useEffect(
    () =>
      sessionStore.events.on('ended', () => {
        usePermissionStore.getState().clear();
        queryClient.clear();
        const redirect = globalThis.location.pathname;
        void router.navigate({
          to: '/login',
          search: isPublic(redirect) ? {} : { redirect },
          replace: true,
        });
      }),
    [router],
  );

  return null;
}

export function App({ context }: { context: AppContext }) {
  return (
    <GlobalProvider context={context}>
      <SessionWatcher router={context.router} />
      <RouterProvider router={context.router} />
    </GlobalProvider>
  );
}
