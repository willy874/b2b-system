import type { AppContext } from '@b2b-system/web-core/app';
import { sessionStore, useHasSession } from '@b2b-system/web-core/auth';
import { queryClient } from '@b2b-system/web-core/cache';
import { GlobalProvider } from '@b2b-system/web-core/shell';
import { usePermissionStore } from '@b2b-system/web-core/store';
import { RouterProvider } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';

import { AUTH_PROFILE_QUERY_KEY } from '@/apis/auth/get-profile/query';
import { useSyncPermissions } from '@/features/login';

import { isPublic, loginSearchAfterSessionEnd } from './sessionRedirect';

function SessionWatcher({ router }: { router: AppContext['router'] }) {
  // 整個 app 只有一個權限水合實例
  useSyncPermissions();
  const hasSession = useHasSession();

  // 完全沒有 session（例如直接貼受保護的網址）→ 導向登入頁並記住原本要去的地方
  const hadSession = useRef(hasSession);
  useEffect(() => {
    if (hasSession) {
      hadSession.current = true;
      return;
    }
    // session 中途結束（登出、被撤銷）交給下方的 `ended`：導向登入頁但 **不** 自動跳到 IdP。
    // 這裡若也導向，登入頁會立刻跳去 IdP——頁面卸載會取消還在路上的登出請求，
    // IdP session 沒被銷毀，使用者又被直接登回來（docs/architecture/04-sso.md §12.2 D5）
    if (hadSession.current) return;
    const { pathname, search } = globalThis.location;
    if (isPublic(pathname)) return;
    // 連同查詢字串（列表的篩選、分頁）一起記住
    void router.navigate({
      to: '/login',
      search: { redirect: `${pathname}${search}` },
      replace: true,
    });
  }, [hasSession, router]);

  useEffect(
    () =>
      sessionStore.events.on('ended', (reason) => {
        usePermissionStore.getState().clear();
        queryClient.clear();
        void router.navigate({
          to: '/login',
          search: loginSearchAfterSessionEnd(reason, globalThis.location),
          replace: true,
        });
      }),
    [router],
  );

  return null;
}

export function App({ context }: { context: AppContext }) {
  return (
    <GlobalProvider context={context} profileQueryKey={AUTH_PROFILE_QUERY_KEY}>
      <SessionWatcher router={context.router} />
      <RouterProvider router={context.router} />
    </GlobalProvider>
  );
}
