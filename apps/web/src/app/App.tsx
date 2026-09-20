import { RouterProvider } from '@tanstack/react-router';
import { useEffect } from 'react';

import type { AppContext } from '@/core/app';
import { sessionStore, useHasSession } from '@/core/auth';
import { queryClient } from '@/core/cache';
import { usePermissionStore } from '@/core/store';
import { useSyncPermissions } from '@/features/auth';

import { GlobalProvider } from './GlobalProvider';

function SessionWatcher({ router }: { router: AppContext['router'] }) {
  // 整個 app 只有一個權限水合實例
  useSyncPermissions();
  const hasSession = useHasSession();

  // 完全沒有 session（例如直接貼受保護的網址）→ 導向登入頁並記住原本要去的地方
  useEffect(() => {
    if (hasSession) return;
    const pathname = globalThis.location.pathname;
    if (pathname.startsWith('/auth')) return;
    void router.navigate({
      to: '/auth/login',
      search: { redirect: pathname },
      replace: true,
    });
  }, [hasSession, router]);

  useEffect(
    () =>
      sessionStore.events.on('ended', () => {
        usePermissionStore.getState().clear();
        queryClient.clear();
        const redirect = globalThis.location.pathname;
        void router.navigate({
          to: '/auth/login',
          search: redirect.startsWith('/auth') ? {} : { redirect },
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
