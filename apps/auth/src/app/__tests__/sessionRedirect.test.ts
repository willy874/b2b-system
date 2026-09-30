import { describe, expect, it } from 'vitest';

import { isPublic, loginSearchAfterSessionEnd } from '../sessionRedirect';

describe('loginSearchAfterSessionEnd（session 結束後的登入頁參數，UX-12）', () => {
  it('帶上原因與完整網址（含查詢字串）', () => {
    expect(
      loginSearchAfterSessionEnd('AUTH_REFRESH_EXPIRED', {
        pathname: '/tenant',
        search: '?status=failed&offset=50',
      }),
    ).toEqual({
      signedOut: true,
      reason: 'AUTH_REFRESH_EXPIRED',
      redirect: '/tenant?status=failed&offset=50',
    });
  });

  it('自己登出不帶原因', () => {
    expect(loginSearchAfterSessionEnd('logout', { pathname: '/admin', search: '' })).toEqual({
      signedOut: true,
      reason: undefined,
      redirect: '/admin',
    });
  });

  it('在公開頁面（登入、帳號流程）結束時不記 redirect', () => {
    expect(
      loginSearchAfterSessionEnd('AUTH_REFRESH_REVOKED', {
        pathname: '/reset-password',
        search: '?token=secret',
      }).redirect,
    ).toBeUndefined();
  });
});

describe('isPublic', () => {
  it.each([
    ['/login', true],
    ['/interaction/abc', true],
    ['/enter', true],
    ['/tenant', false],
    ['/loginx', false],
  ])('%s → %s', (pathname, expected) => {
    expect(isPublic(pathname)).toBe(expected);
  });
});
