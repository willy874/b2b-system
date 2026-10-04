import { LOGOUT_REASON } from '@/features/auth';

/** 不需要 session 的頁面：SSO 的起點與 callback。 */
export function isPublic(pathname: string): boolean {
  return pathname === '/auth' || pathname.startsWith('/auth/');
}

export interface LoginSearchAfterSessionEnd {
  signedOut: true;
  reason?: string;
  redirect?: string;
}

/**
 * session 中途結束後導向登入頁的參數（與 apps/platform 的 app/sessionRedirect.ts 相同）：
 * - `signedOut`：登入頁不自動跳到 IdP（單一登出可能還沒完成，見 features/auth 的登入頁）
 * - `reason`：不是自己登出時，登入頁說明為什麼（逾時、帳號停用、憑證重用、密碼已變更…）
 * - `redirect`：連同查詢字串（列表的篩選、分頁），重新登入後回到同一個網址；登入相關頁面不記
 */
export function loginSearchAfterSessionEnd(
  reason: string,
  location: { pathname: string; search: string },
): LoginSearchAfterSessionEnd {
  return {
    signedOut: true,
    reason: reason === LOGOUT_REASON ? undefined : reason,
    redirect: isPublic(location.pathname) ? undefined : `${location.pathname}${location.search}`,
  };
}
