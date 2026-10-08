import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createAuthorizationUrl,
  discardPendingLogin,
  endSessionUrlOf,
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

describe('SSO 的瀏覽器端（docs/architecture/04-sso.md §12）', () => {
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

  it('end-session 網址：client 與登出後回到的頁面（伺服器端登出失敗時的手動退路，§3.4）', () => {
    const url = new URL(endSessionUrlOf(CONFIG, '/auth/login'));
    expect(`${url.origin}${url.pathname}`).toBe('https://auth.example.com/api/oidc/session/end');
    expect(url.searchParams.get('client_id')).toBe('backstage');
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe(`${location.origin}/auth/login`);
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
    // 路徑段正規化後變成 `//evil.example.com`：origin 仍是本站，回傳值卻是 protocol-relative 的外站網址
    ['/.//evil.example.com', '/'],
    ['/a/..//evil.example.com', '/'],
    ['/%2e//evil.example.com', '/'],
    ['/./\\evil.example.com', '/'],
    // 一般的路徑正規化不受影響
    ['/a/../users', '/users'],
    [undefined, '/'],
  ])('safeReturnTo(%s) → %s（只接受同 origin 的路徑）', (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });

  it('extraParams 會附加到授權網址（例：backstage 的 tenant）', async () => {
    const url = new URL(await createAuthorizationUrl(CONFIG, '/', { tenant: 'acme' }));
    expect(url.searchParams.get('tenant')).toBe('acme');
  });

  it('外站的 returnTo 在存入時就被換成 /', async () => {
    const url = new URL(await createAuthorizationUrl(CONFIG, 'https://evil.example.com'));
    expect(readPendingLogin(url.searchParams.get('state') ?? undefined)?.returnTo).toBe('/');
  });

  it('沒有 state 時取不到', () => {
    expect(readPendingLogin(undefined)).toBeUndefined();
    expect(readPendingLogin('')).toBeUndefined();
  });

  it('存的內容不是 JSON → 視同沒有，不能兌換', () => {
    sessionStorage.setItem('sso:pending:broken', '{not-json');
    expect(readPendingLogin('broken')).toBeUndefined();
  });

  it('存的內容缺 verifier → 視同沒有', () => {
    sessionStorage.setItem('sso:pending:no-verifier', JSON.stringify({ returnTo: '/users' }));
    expect(readPendingLogin('no-verifier')).toBeUndefined();
  });

  it('存的 returnTo 被竄改成外站 → 讀出時換成 /', () => {
    sessionStorage.setItem(
      'sso:pending:tampered',
      JSON.stringify({ verifier: 'v', returnTo: '//evil.example.com' }),
    );
    expect(readPendingLogin('tampered')).toEqual({ verifier: 'v', returnTo: '/' });
  });

  it('discardPendingLogin(undefined) 不動到其他分頁發起的登入', () => {
    sessionStorage.setItem('sso:pending:other', JSON.stringify({ verifier: 'v', returnTo: '/' }));
    discardPendingLogin(undefined);
    expect(readPendingLogin('other')).toEqual({ verifier: 'v', returnTo: '/' });
  });
});

describe('safeReturnTo（無法解析的網址）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('瀏覽器無法解析時回 /', () => {
    vi.spyOn(URL, 'canParse').mockReturnValue(false);
    expect(safeReturnTo('/users')).toBe('/');
  });
});
