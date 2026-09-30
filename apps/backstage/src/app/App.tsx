import { RouterProvider } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';

import type { AppContext } from '@/core/app';
import { sessionStore, useHasSession } from '@/core/auth';
import { queryClient } from '@/core/cache';
import { usePermissionStore } from '@/core/store';
import { useSyncPermissions } from '@/features/auth';

import { useSyncFeatures } from './features';
import { GlobalProvider } from './GlobalProvider';
import { isPublic, loginSearchAfterSessionEnd } from './sessionRedirect';

function SessionWatcher({ router }: { router: AppContext['router'] }) {
  // 整個 app 只有一個權限水合實例；可啟用 feature 的清單跟著同一個 profile 走
  useSyncPermissions();
  useSyncFeatures();
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
    // IdP session 沒被銷毀，使用者又被直接登回來（docs/adr/0019-sso-identity-platform.md D5）
    if (hadSession.current) return;
    const { pathname, search } = globalThis.location;
    if (isPublic(pathname)) return;
    // 連同查詢字串（列表的篩選、分頁）一起記住
    void router.navigate({
      to: '/auth/login',
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
          to: '/auth/login',
          search: loginSearchAfterSessionEnd(reason, globalThis.location),
          replace: true,
          // session 已經結束：未儲存提醒（useUnsavedChangesGuard）留不住使用者，直接離開
          ignoreBlocker: true,
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
