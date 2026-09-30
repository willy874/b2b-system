import { beforeEach, describe, expect, it } from 'vitest';

import {
  createAuthorizationUrl,
  discardPendingLogin,
  readPendingLogin,
  safeReturnTo,
} from '../sso';

const CONFIG = {
  issuer: 'https://auth.example.com/api/oidc',
  clientId: 'backstage',
  callbackPath: '/auth/callback',
};

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return btoa(String.fromCodePoint(...new Uint8Array(digest)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

describe('SSO 的瀏覽器端（docs/adr/0019-sso-identity-platform.md）', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('授權網址帶 client、redirect URI、S256 challenge；verifier 以 state 存在這個分頁', async () => {
    const url = new URL(await createAuthorizationUrl(CONFIG, '/users'));
    expect(`${url.origin}${url.pathname}`).toBe('https://auth.example.com/api/oidc/auth');
    const params = url.searchParams;
    expect(params.get('client_id')).toBe('backstage');
    expect(params.get('redirect_uri')).toBe(`${location.origin}/auth/callback`);
    expect(params.get('response_type')).toBe('code');
    expect(params.get('code_challenge_method')).toBe('S256');

    const pending = readPendingLogin(params.get('state') ?? undefined);
    expect(pending?.returnTo).toBe('/users');
    expect(params.get('code_challenge')).toBe(await sha256Base64Url(pending!.verifier));
  });

  it('丟棄之後取不到；不認識的 state 取不到', async () => {
    const url = new URL(await createAuthorizationUrl(CONFIG, undefined));
    const state = url.searchParams.get('state') ?? undefined;
    expect(readPendingLogin(state)?.returnTo).toBe('/');
    discardPendingLogin(state);
    expect(readPendingLogin(state)).toBeUndefined();
    expect(readPendingLogin('someone-else')).toBeUndefined();
  });

  it.each([
    ['/users?keyword=a', '/users?keyword=a'],
    ['//evil.example.com', '/'],
    ['https://evil.example.com', '/'],
    // 瀏覽器把 `\` 當成 `/`：字面上是 `/` 開頭，實際上是 `//evil.example.com`
    ['/\\evil.example.com', '/'],
    ['/\\/evil.example.com', '/'],
    // 編碼過的反斜線只是路徑的一部分，留在同一個 origin
    ['/%5Cevil.example.com', '/%5Cevil.example.com'],
    ['/users#row-1', '/users#row-1'],
    [undefined, '/'],
  ])('safeReturnTo(%s) → %s（只接受同 origin 的路徑）', (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });
});
