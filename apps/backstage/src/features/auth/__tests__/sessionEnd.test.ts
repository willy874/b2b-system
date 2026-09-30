import { describe, expect, it } from 'vitest';

import { sessionEndMessageKey } from '../sessionEnd';

describe('sessionEndMessageKey（登入頁說明 session 為什麼結束）', () => {
  it.each([
    [undefined, 'auth.login.signedOut'],
    ['logout', 'auth.login.signedOut'],
    // 單一登出：其他產品登出了
    ['AUTH_REFRESH_REVOKED', 'auth.login.signedOut'],
    ['main_session_ended', 'auth.login.signedOut'],
    ['password_changed', 'auth.login.passwordChanged'],
    ['AUTH_REFRESH_EXPIRED', 'error.AUTH_REFRESH_EXPIRED'],
    ['AUTH_REFRESH_REUSED', 'error.AUTH_REFRESH_REUSED'],
    ['AUTH_ACCOUNT_DISABLED', 'error.AUTH_ACCOUNT_DISABLED'],
    ['TENANT_UNAVAILABLE', 'error.TENANT_UNAVAILABLE'],
    ['refresh_failed', 'auth.login.sessionEnded'],
    ['<script>', 'auth.login.sessionEnded'],
  ])('%s → %s', (reason, expected) => {
    expect(sessionEndMessageKey(reason)).toBe(expected);
  });
});
