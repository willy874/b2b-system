import type { AnyRouter } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';

import { sessionStore, useHasSession } from '../auth';
import { queryClient } from '../cache';
import { usePermissionStore } from '../store';

export interface SessionWatcherProps {
  /** app 的 router：`SessionWatcher` 放在 `RouterProvider` 之外，以參數傳入。 */
  router: AnyRouter;
  /** 登入頁的路徑（backstage `/auth/login`、apps/platform `/login`）。 */
  loginPath: string;
  /** 不需要 session 的頁面（登入、SSO callback、帳號流程）：沒有 session 時不導向登入頁。 */
  isPublic: (pathname: string) => boolean;
  /**
   * session 中途結束後導向登入頁的查詢參數（app 的 `app/sessionRedirect.ts`）：
   * `signedOut`（登入頁不自動跳到 IdP）、`reason`、`redirect`。
   */
  loginSearchAfterSessionEnd: (
    reason: string,
    location: { pathname: string; search: string },
  ) => object;
}

/**
 * 以目前使用者身分取得、session 結束時要清掉的資料（docs/architecture/frontend/09-state-and-storage.md §3.3）。
 * 不清的話，下一個在同一個分頁登入的人會先看到上一個人的資料。
 *
 * - 權限集合（唯一進 store 的伺服器狀態）
 * - TanStack Query 的快取（含 mutation）
 *
 * 批次佇列與上傳暫存由各自的 plugin 訂閱同一個 `ended` 清除（backstage 的 `batchQueuePlugin`、file feature）。
 */
function clearUserData(): void {
  usePermissionStore.getState().clear();
  queryClient.clear();
}

/** 目前的網址（router 最新的位置；瀏覽器上與 `location` 相同，測試的記憶體路由也適用）。 */
function currentLocation(router: AnyRouter): { pathname: string; search: string } {
  const { pathname, searchStr } = router.latestLocation;
  return { pathname, search: searchStr };
}

/**
 * 主 session 的生命週期與畫面去向（兩個 app 共用，docs/architecture/frontend/04-routing.md §4.3）：
 *
 * - 完全沒有 session（例：直接貼受保護的網址）→ 導向登入頁並記住原本要去的地方（連同查詢字串）。
 * - session 中途結束（登出、被撤銷、續期被拒、密碼已變更）→ 清掉以使用者身分取得的資料，導向登入頁但 **不** 自動跳到 IdP
 *   （docs/architecture/04-sso.md §12.2 D5）。導覽帶 `ignoreBlocker`：session 已經結束，未儲存提醒
 *   （`useUnsavedChangesGuard`、`useDialogUnsavedGuard`）留不住使用者（docs/architecture/frontend/04-routing.md §2.1）。
 *
 * 權限水合（`useSyncPermissions`）等 app 自己的同步 hook 不經過這裡：app 在旁邊掛自己的元件呼叫它們。
 */
export function SessionWatcher({
  router,
  loginPath,
  isPublic,
  loginSearchAfterSessionEnd,
}: SessionWatcherProps) {
  const hasSession = useHasSession();
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
    const { pathname, search } = currentLocation(router);
    if (isPublic(pathname)) return;
    // 連同查詢字串（列表的篩選、分頁）一起記住
    void router.navigate({
      to: loginPath,
      search: { redirect: `${pathname}${search}` },
      replace: true,
    });
  }, [hasSession, isPublic, loginPath, router]);

  useEffect(
    () =>
      sessionStore.events.on('ended', (reason) => {
        clearUserData();
        void router.navigate({
          to: loginPath,
          search: loginSearchAfterSessionEnd(reason, currentLocation(router)),
          replace: true,
          // session 已經結束：未儲存提醒留不住使用者，直接離開。endSession() 常在表單的 state 還沒 commit 時同步觸發
          // （例：改密碼成功後先清空欄位再結束 session），blocker 讀到的 dirty 仍是 true
          ignoreBlocker: true,
        });
      }),
    [loginPath, loginSearchAfterSessionEnd, router],
  );

  return null;
}
