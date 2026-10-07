import { describe, expect, it } from 'vitest';

import { loginSearchAfterSessionEnd } from '../loginSearch';

const isPublic = (pathname: string) => pathname === '/login' || pathname.startsWith('/login/');

describe('loginSearchAfterSessionEnd（session 結束後的登入頁參數）', () => {
  it('帶上原因與完整網址（含查詢字串）', () => {
    expect(
      loginSearchAfterSessionEnd(
        'AUTH_REFRESH_EXPIRED',
        { pathname: '/user', search: '?status=locked&offset=40' },
        isPublic,
      ),
    ).toEqual({
      signedOut: true,
      reason: 'AUTH_REFRESH_EXPIRED',
      redirect: '/user?status=locked&offset=40',
    });
  });

  it('自己登出不帶原因', () => {
    expect(
      loginSearchAfterSessionEnd('logout', { pathname: '/role', search: '' }, isPublic),
    ).toEqual({ signedOut: true, reason: undefined, redirect: '/role' });
  });

  it('在公開頁面（登入相關）結束時不記 redirect', () => {
    expect(
      loginSearchAfterSessionEnd(
        'AUTH_REFRESH_REVOKED',
        { pathname: '/login/callback', search: '?code=secret' },
        isPublic,
      ).redirect,
    ).toBeUndefined();
  });
});
