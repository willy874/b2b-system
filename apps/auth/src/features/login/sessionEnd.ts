import { getErrorMessageKey } from '@/core/errors';

/** 使用者自己按登出（`useLogoutMutation`）：網址上不帶原因。 */
export const LOGOUT_REASON = 'logout';

/** 平台管理者在個人資料頁變更密碼後結束 session（account 的個人資料頁）：登入頁請他用新密碼登入。 */
export const PASSWORD_CHANGED_REASON = 'password_changed';

/**
 * 這些「原因」其實就是登出：自己登出、同一個 IdP session 的其他產品登出（單一登出回 `AUTH_REFRESH_REVOKED`，
 * docs/architecture/04-sso.md §12.2 D5）、主要 session 結束時一併結束的其他後端 session。
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
  if (reason === PASSWORD_CHANGED_REASON) return 'login.passwordChanged';
  return getErrorMessageKey(reason) ?? 'login.sessionEnded';
}
