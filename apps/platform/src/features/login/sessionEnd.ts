import { sessionEndMessageKey as coreSessionEndMessageKey } from '@b2b-system/web-core/auth';

/** 登入頁說明 session 為什麼結束的三句話（原因的對照在 web-core 的 `sessionEndMessageKey`）。 */
const SESSION_END_MESSAGE_KEYS = {
  signedOut: 'login.signedOut',
  passwordChanged: 'login.passwordChanged',
  sessionEnded: 'login.sessionEnded',
} as const;

/** session 結束的原因 → 登入頁顯示的語系鍵。 */
export function sessionEndMessageKey(reason: string | undefined): string {
  return coreSessionEndMessageKey(reason, SESSION_END_MESSAGE_KEYS);
}
