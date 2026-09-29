import { RouterProvider } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';

import type { AppContext } from '@/core/app';
import { sessionStore, useHasSession } from '@/core/auth';
import { queryClient } from '@/core/cache';
import { usePermissionStore } from '@/core/store';
import { useSyncPermissions } from '@/features/login';

import { GlobalProvider } from './GlobalProvider';

/** 不需要 session 的頁面：SSO 的起點與 callback、IdP 的登入互動與錯誤頁（之後還有帳號流程）。 */
const PUBLIC_PREFIXES = ['/login', '/callback', '/interaction', '/error'];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

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
    // IdP session 沒被銷毀，使用者又被直接登回來（docs/adr/0019-sso-identity-platform.md D5）
    if (hadSession.current) return;
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
        // signedOut：登入頁不自動跳到 IdP（單一登出可能還沒完成，見 features/login 的登入頁）
        void router.navigate({
          to: '/login',
          search: isPublic(redirect) ? { signedOut: true } : { redirect, signedOut: true },
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
