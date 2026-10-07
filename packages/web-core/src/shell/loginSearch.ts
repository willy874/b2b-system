import { LOGOUT_REASON } from '../auth';

/** session 中途結束後導向登入頁的查詢參數；兩個 app 的登入頁都認得這個形狀。 */
export interface LoginSearchAfterSessionEnd {
  signedOut: true;
  reason?: string;
  redirect?: string;
}

/**
 * session 中途結束後導向登入頁的參數（`SessionWatcher` 用）：
 * - `signedOut`：登入頁不自動跳到 IdP（單一登出可能還沒完成，docs/architecture/04-sso.md §12.2 D5）
 * - `reason`：不是自己登出時，登入頁說明為什麼（逾時、帳號停用、憑證重用、密碼已變更…）
 * - `redirect`：連同查詢字串（列表的篩選、分頁），重新登入後回到同一個網址；公開頁面（登入相關）不記
 */
export function loginSearchAfterSessionEnd(
  reason: string,
  location: { pathname: string; search: string },
  isPublic: (pathname: string) => boolean,
): LoginSearchAfterSessionEnd {
  return {
    signedOut: true,
    reason: reason === LOGOUT_REASON ? undefined : reason,
    redirect: isPublic(location.pathname) ? undefined : `${location.pathname}${location.search}`,
  };
}
