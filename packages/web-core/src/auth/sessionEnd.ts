import { getErrorMessageKey } from '../errors';

/** 使用者自己按登出（各 app 的 `useLogoutMutation`）：登入頁不說明原因，網址上也不帶。 */
export const LOGOUT_REASON = 'logout';

/** 變更密碼後結束 session（`useChangePasswordForm`）：登入頁請使用者用新密碼登入。 */
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

/** 登入頁的三句說明；字串屬於各 app 的登入 feature，以完整字面量的語系鍵傳入。 */
export interface SessionEndMessageKeys {
  /** 已登出 */
  signedOut: string;
  /** 密碼已變更，請用新密碼登入 */
  passwordChanged: string;
  /** 不認得的原因：通用的「登入狀態已結束」 */
  sessionEnded: string;
}

/**
 * session 結束的原因（`SessionStore.endSession(reason)`，多半是後端錯誤碼）→ 登入頁顯示的語系鍵。
 * 逾時、帳號停用、偵測到憑證重用、租戶停用各有說明（錯誤碼的翻譯）；不認得的原因用 `keys.sessionEnded`。
 */
export function sessionEndMessageKey(
  reason: string | undefined,
  keys: SessionEndMessageKeys,
): string {
  if (!reason || SIGNED_OUT_REASONS.has(reason)) return keys.signedOut;
  if (reason === PASSWORD_CHANGED_REASON) return keys.passwordChanged;
  return getErrorMessageKey(reason) ?? keys.sessionEnded;
}
