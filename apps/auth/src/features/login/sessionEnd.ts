import { getErrorMessageKey } from '@/core/errors';

/** 使用者自己按登出（`useLogoutMutation`）：網址上不帶原因。 */
export const LOGOUT_REASON = 'logout';

/**
 * 這些「原因」其實就是登出：自己登出、同一個 IdP session 的其他產品登出（單一登出回 `AUTH_REFRESH_REVOKED`，
 * docs/adr/0019-sso-identity-platform.md D5）、主要 session 結束時一併結束的其他後端 session。
 */
const SIGNED_OUT_REASONS: ReadonlySet<string> = new Set([
  LOGOUT_REASON,
  'AUTH_REFRESH_REVOKED',
  'main_session_ended',
]);

/**
 * session 結束的原因（`SessionStore.endSession(reason)`，多半是後端錯誤碼）→ 登入頁顯示的語系鍵。
 * 逾時、帳號停用、偵測到憑證重用、租戶停用各有說明；不認得的原因用通用的「登入狀態已結束」。
 */
export function sessionEndMessageKey(reason: string | undefined): string {
  if (!reason || SIGNED_OUT_REASONS.has(reason)) return 'login.signedOut';
  return getErrorMessageKey(reason) ?? 'login.sessionEnded';
}
