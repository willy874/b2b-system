import { createSign, generateKeyPairSync } from 'node:crypto';

import * as client from 'openid-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OpenIdExternalOidcClient } from '../external-oidc.client';
import type { ExternalProviderConfig } from '../external-oidc.client';

// 只把 authorizationCodeGrant 包成可替換的 spy（預設走原本的實作），其他照舊
vi.mock('openid-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('openid-client')>();
  return { ...original, authorizationCodeGrant: vi.fn(original.authorizationCodeGrant) };
});

const ISSUER = 'https://idp.example.com';
const CLIENT_ID = 'b2b-client';
const REDIRECT_URI = 'https://app.example.com/api/oidc-interaction/external/callback';
const NOW_SECONDS = 1_790_000_000;

const PROVIDER: ExternalProviderConfig = {
  issuer: ISSUER,
  clientId: CLIENT_ID,
  clientSecret: 'secret-1',
  scopes: 'openid email profile',
};

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** 外部 IdP 簽發的 ID token（RS256）。 */
function idToken(claims: Record<string, unknown>): string {
  const signingInput = `${b64({ alg: 'RS256', typ: 'JWT', kid: 'k1' })}.${b64(claims)}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey);
  return `${signingInput}.${signature.toString('base64url')}`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface FakeIdpOptions {
  issuer?: string;
  /** discovery 回應的 `issuer`（預設與請求的相同）。 */
  metadataIssuer?: string;
  discoveryStatus?: number;
  claims?: Record<string, unknown>;
  /** 整個 token 回應（覆寫預設）。 */
  tokenResponse?: { status: number; body: unknown };
  userinfo?: Record<string, unknown>;
}

/** 以 `vi.stubGlobal('fetch')` 模擬外部 IdP：discovery、token、JWKS、userinfo。 */
function fakeIdp(options: FakeIdpOptions = {}) {
  const issuer = options.issuer ?? ISSUER;
  const requests: Array<{ url: string; method: string; body: string; headers: Headers }> = [];
  const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    requests.push({
      url: url.toString(),
      method: init.method ?? 'GET',
      body: init.body === undefined || init.body === null ? '' : String(init.body),
      headers: new Headers(init.headers),
    });
    switch (url.pathname) {
      case '/.well-known/openid-configuration':
        if (options.discoveryStatus)
          return new Response('down', { status: options.discoveryStatus });
        return json({
          issuer: options.metadataIssuer ?? issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          userinfo_endpoint: `${issuer}/userinfo`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
        });
      case '/token': {
        if (options.tokenResponse) {
          return json(options.tokenResponse.body, options.tokenResponse.status);
        }
        const now = Math.floor(Date.now() / 1000);
        return json({
          access_token: 'access-token-1',
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: idToken({
            iss: issuer,
            aud: CLIENT_ID,
            sub: 'ext-sub-1',
            iat: now,
            exp: now + 300,
            nonce: 'nonce-1',
            ...options.claims,
          }),
        });
      }
      case '/jwks':
        return json({
          keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }],
        });
      case '/userinfo':
        return json(options.userinfo ?? { sub: 'ext-sub-1' });
      default:
        return new Response('not found', { status: 404 });
    }
  });
  vi.stubGlobal('fetch', fetch);
  const discoveries = () =>
    requests.filter((r) => r.url.endsWith('/.well-known/openid-configuration'));
  return { fetch, requests, discoveries };
}

function oidcClient(
  overrides: Partial<ConstructorParameters<typeof OpenIdExternalOidcClient>[0]> = {},
) {
  return new OpenIdExternalOidcClient({
    allowInsecureIssuer: false,
    blockPrivateNetworks: false,
    ...overrides,
  });
}

/** 第 index 個連線：只有 client id 不同，各自一筆 discovery 快取。 */
function providerOf(index: number): ExternalProviderConfig {
  return { ...PROVIDER, clientId: `client-${index}` };
}

const EXCHANGE = {
  currentUrl: `${REDIRECT_URI}?code=auth-code-1&state=state-1`,
  state: 'state-1',
  nonce: 'nonce-1',
  codeVerifier: 'verifier-1234567890-verifier-1234567890-abc',
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW_SECONDS * 1000);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.mocked(client.authorizationCodeGrant).mockClear();
});

describe('OpenIdExternalOidcClient（docs/architecture/04-sso.md §12.2 D8）', () => {
  describe('authorizationUrl', () => {
    it('依 discovery 的 authorization_endpoint 組出帶 state、nonce、PKCE（S256）與 scope 的網址', async () => {
      const idp = fakeIdp();
      const url = new URL(
        await oidcClient().authorizationUrl(PROVIDER, {
          redirectUri: REDIRECT_URI,
          state: 'state-1',
          nonce: 'nonce-1',
          codeChallenge: 'challenge-1',
        }),
      );
      expect(`${url.origin}${url.pathname}`).toBe(`${ISSUER}/authorize`);
      expect(Object.fromEntries(url.searchParams)).toMatchObject({
        client_id: CLIENT_ID,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        scope: 'openid email profile',
        state: 'state-1',
        nonce: 'nonce-1',
        code_challenge: 'challenge-1',
        code_challenge_method: 'S256',
      });
      expect(idp.discoveries()).toHaveLength(1);
    });

    it('同一個 issuer＋client＋secret 只做一次 discovery', async () => {
      const idp = fakeIdp();
      const oidc = oidcClient();
      const params = { redirectUri: REDIRECT_URI, state: 's', nonce: 'n', codeChallenge: 'c' };
      await oidc.authorizationUrl(PROVIDER, params);
      await oidc.authorizationUrl(PROVIDER, params);
      await oidc.exchange(PROVIDER, EXCHANGE);
      expect(idp.discoveries()).toHaveLength(1);
    });

    it('換了 client secret 就重新 discovery（快取的 key 含 secret 的雜湊）', async () => {
      const idp = fakeIdp();
      const oidc = oidcClient();
      const params = { redirectUri: REDIRECT_URI, state: 's', nonce: 'n', codeChallenge: 'c' };
      await oidc.authorizationUrl(PROVIDER, params);
      await oidc.authorizationUrl({ ...PROVIDER, clientSecret: 'secret-2' }, params);
      expect(idp.discoveries()).toHaveLength(2);
    });
  });

  describe('discovery 失敗', () => {
    it('IdP 回 5xx → 拒絕，而且不快取失敗（下一次重新 discovery）', async () => {
      const idp = fakeIdp({ discoveryStatus: 503 });
      const oidc = oidcClient();
      const params = { redirectUri: REDIRECT_URI, state: 's', nonce: 'n', codeChallenge: 'c' };
      const unavailable = { code: 'OAUTH_RESPONSE_IS_NOT_CONFORM' };
      await expect(oidc.authorizationUrl(PROVIDER, params)).rejects.toMatchObject(unavailable);
      await expect(oidc.authorizationUrl(PROVIDER, params)).rejects.toMatchObject(unavailable);
      expect(idp.discoveries()).toHaveLength(2);
    });

    it('discovery 回報的 issuer 與設定不同 → 拒絕', async () => {
      fakeIdp({ metadataIssuer: 'https://evil.example.com' });
      await expect(
        oidcClient().authorizationUrl(PROVIDER, {
          redirectUri: REDIRECT_URI,
          state: 's',
          nonce: 'n',
          codeChallenge: 'c',
        }),
      ).rejects.toMatchObject({ code: 'OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED' });
    });

    it('http 的 issuer：production（allowInsecureIssuer=false）拒絕，開發環境允許', async () => {
      const insecure = { ...PROVIDER, issuer: 'http://idp.example.com' };
      fakeIdp({ issuer: insecure.issuer });
      const params = { redirectUri: REDIRECT_URI, state: 's', nonce: 'n', codeChallenge: 'c' };
      await expect(oidcClient().authorizationUrl(insecure, params)).rejects.toMatchObject({
        code: 'OAUTH_HTTP_REQUEST_FORBIDDEN',
      });
      await expect(
        oidcClient({ allowInsecureIssuer: true }).authorizationUrl(insecure, params),
      ).resolves.toMatch(/^http:\/\/idp\.example\.com\/authorize\?/);
    });

    it.each([
      ['自訂的 resolve', { resolve: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) }],
      ['系統的 DNS', {}],
    ])('blockPrivateNetworks：issuer 是私有位址 → 不連線就拒絕（%s）', async (_name, extra) => {
      const idp = fakeIdp();
      await expect(
        oidcClient({ blockPrivateNetworks: true, ...extra }).authorizationUrl(
          { ...PROVIDER, issuer: 'https://10.0.0.5' },
          { redirectUri: REDIRECT_URI, state: 's', nonce: 'n', codeChallenge: 'c' },
        ),
      ).rejects.toMatchObject({ cause: { hostname: '10.0.0.5' } });
      expect(idp.fetch).not.toHaveBeenCalled();
    });

    it('快取超過 200 筆時丟掉最久沒用到的', async () => {
      const idp = fakeIdp();
      const oidc = oidcClient();
      const params = { redirectUri: REDIRECT_URI, state: 's', nonce: 'n', codeChallenge: 'c' };
      for (let index = 0; index < 200; index += 1) {
        // oxlint-disable-next-line no-await-in-loop -- 依序放進快取，順序就是 LRU 的順序
        await oidc.authorizationUrl(providerOf(index), params);
      }
      // 用到 client-0：移到最後，最舊的變成 client-1
      await oidc.authorizationUrl(providerOf(0), params);
      expect(idp.discoveries()).toHaveLength(200);
      await oidc.authorizationUrl(providerOf(200), params);
      expect(idp.discoveries()).toHaveLength(201);

      await oidc.authorizationUrl(providerOf(0), params);
      expect(idp.discoveries()).toHaveLength(201);
      await oidc.authorizationUrl(providerOf(1), params);
      expect(idp.discoveries()).toHaveLength(202);
    });
  });

  describe('exchange', () => {
    it('以授權碼與 PKCE verifier 換 token，ID token 有 email 時直接取用（不打 userinfo）', async () => {
      const idp = fakeIdp({
        claims: { email: 'alice@acme.com', email_verified: true, name: 'Alice' },
      });
      await expect(oidcClient().exchange(PROVIDER, EXCHANGE)).resolves.toEqual({
        subject: 'ext-sub-1',
        email: 'alice@acme.com',
        emailVerified: true,
        name: 'Alice',
      });
      const token = idp.requests.find((r) => r.url === `${ISSUER}/token`)!;
      expect(token.method).toBe('POST');
      const form = new URLSearchParams(token.body);
      expect(form.get('grant_type')).toBe('authorization_code');
      expect(form.get('code')).toBe('auth-code-1');
      expect(form.get('code_verifier')).toBe(EXCHANGE.codeVerifier);
      expect(form.get('redirect_uri')).toBe(REDIRECT_URI);
      expect(idp.requests.some((r) => r.url.endsWith('/userinfo'))).toBe(false);
    });

    it('email_verified 不是 true（例：字串 "true"）→ emailVerified=false；沒有 name → null', async () => {
      fakeIdp({ claims: { email: 'alice@acme.com', email_verified: 'true' } });
      await expect(oidcClient().exchange(PROVIDER, EXCHANGE)).resolves.toEqual({
        subject: 'ext-sub-1',
        email: 'alice@acme.com',
        emailVerified: false,
        name: null,
      });
    });

    it('ID token 沒有 email → 以 access token 查 userinfo 取得 email 與名稱', async () => {
      const idp = fakeIdp({
        userinfo: { sub: 'ext-sub-1', email: 'bob@acme.com', email_verified: true, name: 'Bob' },
      });
      await expect(oidcClient().exchange(PROVIDER, EXCHANGE)).resolves.toEqual({
        subject: 'ext-sub-1',
        email: 'bob@acme.com',
        emailVerified: true,
        name: 'Bob',
      });
      const userinfo = idp.requests.find((r) => r.url === `${ISSUER}/userinfo`)!;
      expect(userinfo.headers.get('authorization')).toMatch(/^Bearer access-token-1$/i);
    });

    it('userinfo 也沒有 email → email=null、emailVerified=false', async () => {
      fakeIdp({ userinfo: { sub: 'ext-sub-1' } });
      await expect(oidcClient().exchange(PROVIDER, EXCHANGE)).resolves.toEqual({
        subject: 'ext-sub-1',
        email: null,
        emailVerified: false,
        name: null,
      });
    });

    it('userinfo 的 sub 與 ID token 不同 → 拒絕', async () => {
      fakeIdp({ userinfo: { sub: 'someone-else', email: 'x@acme.com' } });
      await expect(oidcClient().exchange(PROVIDER, EXCHANGE)).rejects.toMatchObject({
        cause: {
          code: 'OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED',
          message: expect.stringContaining('"sub"'),
        },
      });
    });

    it('callback 的 state 與預期不同 → 拒絕，不兌換授權碼', async () => {
      const idp = fakeIdp();
      await expect(
        oidcClient().exchange(PROVIDER, { ...EXCHANGE, state: 'other-state' }),
      ).rejects.toMatchObject({
        cause: { code: 'OAUTH_INVALID_RESPONSE', message: expect.stringContaining('"state"') },
      });
      expect(idp.requests.some((r) => r.url.endsWith('/token'))).toBe(false);
    });

    it('callback 帶 error（使用者在外部 IdP 拒絕）→ 拒絕', async () => {
      fakeIdp();
      await expect(
        oidcClient().exchange(PROVIDER, {
          ...EXCHANGE,
          currentUrl: `${REDIRECT_URI}?error=access_denied&state=state-1`,
        }),
      ).rejects.toMatchObject({
        code: 'OAUTH_AUTHORIZATION_RESPONSE_ERROR',
        error: 'access_denied',
      });
    });

    it('token 端點回 invalid_grant → 拒絕', async () => {
      fakeIdp({ tokenResponse: { status: 400, body: { error: 'invalid_grant' } } });
      await expect(oidcClient().exchange(PROVIDER, EXCHANGE)).rejects.toMatchObject({
        code: 'OAUTH_RESPONSE_BODY_ERROR',
        error: 'invalid_grant',
      });
    });

    it('token 回應沒有 ID token → 拒絕', async () => {
      fakeIdp({
        tokenResponse: {
          status: 200,
          body: { access_token: 'at', token_type: 'Bearer', expires_in: 60 },
        },
      });
      await expect(oidcClient().exchange(PROVIDER, EXCHANGE)).rejects.toMatchObject({
        cause: { code: 'OAUTH_INVALID_RESPONSE', message: expect.stringContaining('"id_token"') },
      });
    });

    it.each([
      ['nonce 不符', { nonce: 'other-nonce' }, 'OAUTH_JWT_CLAIM_COMPARISON_FAILED', '"nonce"'],
      [
        'audience 不是這個 client',
        { aud: 'another-client' },
        'OAUTH_JWT_CLAIM_COMPARISON_FAILED',
        '"aud"',
      ],
      [
        'issuer 不符',
        { iss: 'https://evil.example.com' },
        'OAUTH_JWT_CLAIM_COMPARISON_FAILED',
        '"iss"',
      ],
      [
        '已過期',
        { exp: NOW_SECONDS - 3600, iat: NOW_SECONDS - 7200 },
        'OAUTH_JWT_TIMESTAMP_CHECK_FAILED',
        '"exp"',
      ],
    ])('ID token 驗證失敗（%s）→ 拒絕', async (_name, claims, code, claim) => {
      fakeIdp({ claims });
      await expect(oidcClient().exchange(PROVIDER, EXCHANGE)).rejects.toMatchObject({
        cause: { code, message: expect.stringContaining(claim) },
      });
    });

    it('token 回應的 claims() 是空的 → 拋錯（防禦：idTokenExpected 時 openid-client 本來就會先擋）', async () => {
      fakeIdp();
      vi.mocked(client.authorizationCodeGrant).mockResolvedValueOnce({
        claims: () => undefined,
      } as never);
      await expect(oidcClient().exchange(PROVIDER, EXCHANGE)).rejects.toThrow(
        '外部 IdP 沒有回傳 ID token',
      );
    });
  });
});
