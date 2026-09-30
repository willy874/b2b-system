import { describe, expect, it } from 'vitest';

import { sessionEndMessageKey } from '../sessionEnd';

describe('sessionEndMessageKey（登入頁說明 session 為什麼結束）', () => {
  it.each([
    [undefined, 'login.signedOut'],
    ['logout', 'login.signedOut'],
    // 單一登出：其他產品登出了
    ['AUTH_REFRESH_REVOKED', 'login.signedOut'],
    ['main_session_ended', 'login.signedOut'],
    ['AUTH_REFRESH_EXPIRED', 'error.AUTH_REFRESH_EXPIRED'],
    ['AUTH_REFRESH_REUSED', 'error.AUTH_REFRESH_REUSED'],
    ['AUTH_ACCOUNT_DISABLED', 'error.AUTH_ACCOUNT_DISABLED'],
    ['AUTH_TOKEN_STALE', 'error.AUTH_TOKEN_STALE'],
    ['refresh_failed', 'login.sessionEnded'],
    ['<script>', 'login.sessionEnded'],
  ])('%s → %s', (reason, expected) => {
    expect(sessionEndMessageKey(reason)).toBe(expected);
  });
});
