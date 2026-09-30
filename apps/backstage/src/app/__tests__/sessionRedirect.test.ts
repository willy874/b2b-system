import { describe, expect, it } from 'vitest';

import { isPublic, loginSearchAfterSessionEnd } from '../sessionRedirect';

describe('loginSearchAfterSessionEnd（session 結束後的登入頁參數，UX-12）', () => {
  it('帶上原因與完整網址（含查詢字串）', () => {
    expect(
      loginSearchAfterSessionEnd('AUTH_REFRESH_EXPIRED', {
        pathname: '/user',
        search: '?status=locked&offset=40',
      }),
    ).toEqual({
      signedOut: true,
      reason: 'AUTH_REFRESH_EXPIRED',
      redirect: '/user?status=locked&offset=40',
    });
  });

  it('自己登出不帶原因', () => {
    expect(loginSearchAfterSessionEnd('logout', { pathname: '/role', search: '' })).toEqual({
      signedOut: true,
      reason: undefined,
      redirect: '/role',
    });
  });

  it('在登入相關頁面結束時不記 redirect', () => {
    expect(
      loginSearchAfterSessionEnd('AUTH_REFRESH_REVOKED', {
        pathname: '/auth/callback',
        search: '?code=secret',
      }).redirect,
    ).toBeUndefined();
  });
});

describe('isPublic', () => {
  it.each([
    ['/auth', true],
    ['/auth/login', true],
    ['/authx', false],
    ['/user', false],
  ])('%s → %s', (pathname, expected) => {
    expect(isPublic(pathname)).toBe(expected);
  });
});
