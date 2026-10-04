import { createHash, randomBytes } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ObjectStorage } from '@/core/storage';
import { platformRefreshTokens } from '@/db/platform/schema';
import { refreshTokens, users } from '@/db/schema';
import { upsertPlatformAdmin } from '@/db/seeds/platform-admin';

import type { PlatformTestDatabase, TestDatabase } from './db';
import { createPlatformTestDatabase, createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { InMemoryObjectStorage } from './in-memory-object-storage';
import { createExtraTenant, testTenantContext } from './tenant';
import { userVersion } from './versions';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let platformDb: PlatformTestDatabase;
const closers: Array<() => Promise<void>> = [];

const SUPER_ADMIN = { email: 'sso-root@example.com', password: 'RootPassword!2026' };
const USER = { email: 'sso-user@example.com', password: 'SsoUserPassword!2026' };
const PLATFORM_ADMIN = { email: 'sso-platform@example.com', password: 'PlatformPassword!2026' };

/**
 * 與 env 預設值一致：apps/platform 在 :5175（不屬於任何租戶，IdP 的端點都在這裡）；
 * 測試租戶 `test` 的網域是 127.0.0.1／localhost，所以 backstage 在 localhost:5173（test/global-setup.ts）。
 * 另一個租戶 `sso-b` 的網域是 sso-b.test。
 */
const AUTH_HOST = 'localhost:5175';
const ISSUER_PATH = '/api/oidc';

interface Client {
  clientId: string;
  redirectUri: string;
  /** backstage 帶的租戶代碼；apps/platform（平台管理者）不帶。 */
  tenant?: string;
  /** BFF 的網域與路徑。 */
  host: string;
  callbackPath: string;
}

const BACKSTAGE: Client = {
  clientId: 'backstage',
  redirectUri: 'http://localhost:5173/auth/callback',
  tenant: 'test',
  host: 'localhost:5173',
  callbackPath: '/auth/sso/callback',
};
const BACKSTAGE_B: Client = {
  clientId: 'backstage',
  redirectUri: 'http://sso-b.test/auth/callback',
  tenant: 'sso-b',
  host: 'sso-b.test',
  callbackPath: '/auth/sso/callback',
};
const AUTH_APP: Client = {
  clientId: 'auth',
  redirectUri: 'http://localhost:5175/callback',
  host: AUTH_HOST,
  callbackPath: '/platform/auth/sso/callback',
};

/** IdP 的端點在 apps/platform 的網域。 */
function idp(method: 'get' | 'post', path: string): request.Test {
  return request(http)[method](path).set('Host', AUTH_HOST);
}

/**
 * 瀏覽器的 cookie jar（只記名稱 → 值）。provider 的 cookie path 是瀏覽器看到的 `/api/...`，
 * 而測試直接打本程序（沒有 `/api` 前綴），所以不能交給 supertest 的 agent 比對 path，改成手動帶。
 */
class CookieJar {
  private readonly cookies = new Map<string, string>();

  store(response: request.Response): void {
    const header = response.headers['set-cookie'] as string[] | string | undefined;
    for (const line of Array.isArray(header) ? header : header ? [header] : []) {
      const [pair] = line.split(';');
      const index = pair!.indexOf('=');
      const name = pair!.slice(0, index);
      const value = pair!.slice(index + 1);
      if (value === '' || /expires=Thu, 01 Jan 1970/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** 瀏覽器看到的網址 → 本程序的路徑（反向代理去掉 `/api`）。 */
function internalPath(url: string): string {
  const { pathname, search } = new URL(url);
  return pathname.replace(/^\/api/, '') + search;
}

function errorCode(response: request.Response): string | undefined {
  return (response.body as { error?: { code?: string } }).error?.code;
}

interface Authorized {
  code: string;
  state: string;
  verifier: string;
}

function authorizeQuery(client: Client, challenge: string, state: string): URLSearchParams {
  const query = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  if (client.tenant) query.set('tenant', client.tenant);
  return query;
}

/** `/oidc/auth`：已有 IdP session 時直接帶授權碼導回；否則走登入互動（`credentials` 必填）。 */
async function authorize(
  jar: CookieJar,
  client: Client,
  credentials?: { email: string; password: string },
): Promise<Authorized> {
  const { verifier, challenge } = pkce();
  const state = randomBytes(8).toString('hex');
  const query = authorizeQuery(client, challenge, state);
  let response = await idp('get', `/oidc/auth?${query.toString()}`).set('cookie', jar.header());
  jar.store(response);
  let location = response.headers.location as string;
  expect(response.status).toBe(303);

  if (location.includes('/oidc-interaction/')) {
    if (!credentials) throw new Error(`預期已有 IdP session，卻被導去登入：${location}`);
    const uid = new URL(location).pathname.split('/').pop()!;

    // 互動網址先到 api，再轉到 apps/platform 的頁面
    const toPage = await idp('get', internalPath(location));
    expect(toPage.status).toBe(302);
    expect(toPage.headers.location).toBe(`http://localhost:5175/interaction/${uid}`);

    const details = await idp('get', `/oidc-interaction/${uid}/details`)
      .set('cookie', jar.header())
      .expect(200);
    expect((details.body as { data: unknown }).data).toMatchObject({
      uid,
      prompt: 'login',
      clientId: client.clientId,
      tenant: client.tenant ? { code: client.tenant } : null,
    });

    const login = await idp('post', `/oidc-interaction/${uid}/login`)
      .set('cookie', jar.header())
      .send(credentials)
      .expect(200);
    const redirectTo = (login.body as { data: { redirectTo: string } }).data.redirectTo;
    expect(redirectTo).toBe(`http://localhost:5175${ISSUER_PATH}/auth/${uid}`);

    // 頂層跳轉回 provider 的 resume：建立 IdP session，帶授權碼導回產品
    response = await idp('get', internalPath(redirectTo)).set('cookie', jar.header());
    jar.store(response);
    expect(response.status).toBe(303);
    location = response.headers.location as string;
  }

  expect(location.startsWith(`${client.redirectUri}?`)).toBe(true);
  const params = new URL(location).searchParams;
  expect(params.get('state')).toBe(state);
  const code = params.get('code');
  if (!code) throw new Error(`沒有授權碼：${location}`);
  return { code, state, verifier };
}

/** 產品的 BFF：在產品自己的網域兌換授權碼。 */
function callback(client: Client, authorized: Authorized, bff: Client = client): request.Test {
  return request(http).post(bff.callbackPath).set('Host', bff.host).send({
    code: authorized.code,
    codeVerifier: authorized.verifier,
    clientId: client.clientId,
    redirectUri: client.redirectUri,
  });
}

function refreshCookieOf(response: request.Response): string {
  const header = response.headers['set-cookie'] as string[] | string | undefined;
  const line = (Array.isArray(header) ? header : [header ?? '']).find((item) =>
    item.startsWith('refresh_token='),
  );
  if (!line) throw new Error('沒有 refresh cookie');
  return line.split(';')[0]!;
}

function tokenOf(response: request.Response): string {
  return (response.body as { data: { accessToken: string } }).data.accessToken;
}

function payloadOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as Record<
    string,
    unknown
  >;
}

describe('SSO（docs/architecture/04-sso.md §12、0020 D5–D10）', () => {
  let userId = '';
  let tenantId = '';
  let tenantB: Awaited<ReturnType<typeof createExtraTenant>>;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN.email;
    process.env.SUPER_ADMIN_PASSWORD = SUPER_ADMIN.password;
    process.env.AUTH_RATE_LIMIT = '1000';

    const created = createTestDatabase();
    db = created.db;
    closers.push(async () => created.client.end());
    await truncateAll(db);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);

    const { hashPassword } = await import('@/modules/credential/password');
    const [user] = await db
      .insert(users)
      .values({
        email: USER.email,
        displayName: 'SSO 使用者',
        passwordHash: await hashPassword(USER.password),
        status: 'active',
      })
      .returning();
    userId = user!.id;

    // 另一個租戶：同一個 email 的另一個帳號（身分分屬各租戶，docs/architecture/05-tenancy.md §10 身分 B）
    tenantB = await createExtraTenant('sso-b', ['sso-b.test']);
    closers.push(tenantB.close);
    await tenantB.db.delete(users).where(eq(users.email, USER.email));
    await tenantB.db.insert(users).values({
      email: USER.email,
      displayName: 'B 租戶的同名帳號',
      passwordHash: await hashPassword(USER.password),
      status: 'active',
    });

    const platform = createPlatformTestDatabase();
    platformDb = platform.db;
    closers.push(async () => platform.client.end());
    await upsertPlatformAdmin(platformDb, { displayName: '平台管理者', ...PLATFORM_ADMIN });

    const { AppModule } = await import('@/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ObjectStorage)
      .useValue(new InMemoryObjectStorage())
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    // 與 main.ts 相同：refresh 與 logout 從 cookie 讀 refresh token
    app.use(cookieParser());
    await app.init();
    http = await listenOnLoopback(app);
    tenantId = (await testTenantContext(app)).id;
  });

  afterAll(async () => {
    await app.close();
    for (const close of closers) await close();
    delete process.env.AUTH_RATE_LIMIT;
  });

  it('discovery 的網址都是瀏覽器看到的（apps/platform origin ＋ /api/oidc）', async () => {
    const response = await idp('get', '/oidc/.well-known/openid-configuration').expect(200);
    const body = response.body as { issuer: string; authorization_endpoint: string };
    expect(body.issuer).toBe(`http://localhost:5175${ISSUER_PATH}`);
    expect(body.authorization_endpoint).toBe(`http://localhost:5175${ISSUER_PATH}/auth`);
  });

  it('租戶的使用者：登入互動查租戶的 DB，token 帶 tid 與 sid；登出結束 IdP session', async () => {
    const jar = new CookieJar();
    const backstage = await callback(BACKSTAGE, await authorize(jar, BACKSTAGE, USER)).expect(200);
    const token = tokenOf(backstage);
    // host-only：不設 Domain（D6）
    expect(String(backstage.headers['set-cookie'])).not.toMatch(/domain=/i);

    const rows = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, userId));
    expect(rows.map((row) => row.clientId)).toEqual(['backstage']);
    expect(payloadOf(token)).toMatchObject({
      sub: userId,
      tid: tenantId,
      sid: rows[0]!.idpSessionUid,
    });

    await request(http)
      .post('/auth/logout')
      .set('Host', BACKSTAGE.host)
      .set('authorization', `Bearer ${token}`)
      .set('cookie', refreshCookieOf(backstage))
      .expect(200);
    // IdP session 已銷毀：再授權要重新登入
    await expect(authorize(jar, BACKSTAGE)).rejects.toThrow(/卻被導去登入/);
  });

  it('同一個 IdP session 換租戶或換成平台 → 要求重新登入（D9），登入後換成新的身分', async () => {
    const jar = new CookieJar();
    await callback(BACKSTAGE, await authorize(jar, BACKSTAGE, USER)).expect(200);
    // 同一個租戶：直接拿到授權碼
    await callback(BACKSTAGE, await authorize(jar, BACKSTAGE)).expect(200);

    // 別的租戶：不能沿用 A 租戶的 IdP session
    await expect(authorize(jar, BACKSTAGE_B)).rejects.toThrow(/卻被導去登入/);
    const inB = await callback(BACKSTAGE_B, await authorize(jar, BACKSTAGE_B, USER)).expect(200);
    const [bUser] = await tenantB.db.select().from(users).where(eq(users.email, USER.email));
    expect(payloadOf(tokenOf(inB))).toMatchObject({ sub: bUser!.id, tid: tenantB.id });

    // apps/platform（平台管理者）：租戶帳號的 session 也不能沿用
    await expect(authorize(jar, AUTH_APP)).rejects.toThrow(/卻被導去登入/);
  });

  it('BFF 只接受自己網域的租戶的授權碼（D10）；平台的 BFF 只接受平台管理者的', async () => {
    const jar = new CookieJar();
    const forA = await authorize(jar, BACKSTAGE, USER);
    // A 租戶的授權碼送到 B 租戶網域的 BFF（redirect URI 照實帶 A 的）
    const crossed = await callback(BACKSTAGE, forA, BACKSTAGE_B).expect(400);
    expect(errorCode(crossed)).toBe('AUTH_SSO_CODE_INVALID');

    const forA2 = await authorize(jar, BACKSTAGE);
    const toPlatform = await callback(BACKSTAGE, forA2, AUTH_APP).expect(400);
    expect(errorCode(toPlatform)).toBe('AUTH_SSO_CODE_INVALID');
  });

  it('授權碼只能兌換一次；PKCE、client、redirect URI 不符一律 AUTH_SSO_CODE_INVALID', async () => {
    const jar = new CookieJar();
    const authorized = await authorize(jar, BACKSTAGE, USER);

    const wrongVerifier = await request(http)
      .post(BACKSTAGE.callbackPath)
      .set('Host', BACKSTAGE.host)
      .send({
        code: authorized.code,
        codeVerifier: pkce().verifier,
        clientId: BACKSTAGE.clientId,
        redirectUri: BACKSTAGE.redirectUri,
      })
      .expect(400);
    expect(errorCode(wrongVerifier)).toBe('AUTH_SSO_CODE_INVALID');

    const wrongClient = await callback(
      { ...BACKSTAGE, clientId: 'auth' },
      authorized,
      BACKSTAGE,
    ).expect(400);
    expect(errorCode(wrongClient)).toBe('AUTH_SSO_CODE_INVALID');

    await callback(BACKSTAGE, authorized).expect(200);
    const replay = await callback(BACKSTAGE, authorized).expect(400);
    expect(errorCode(replay)).toBe('AUTH_SSO_CODE_INVALID');
  });

  it('同一個授權碼的併發兌換只有一個成功', async () => {
    const jar = new CookieJar();
    const authorized = await authorize(jar, BACKSTAGE, USER);
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => callback(BACKSTAGE, authorized)),
    );
    expect(responses.map((response) => response.status).toSorted()).toEqual([200, 400, 400, 400]);
    for (const response of responses.filter((item) => item.status === 400)) {
      expect(errorCode(response)).toBe('AUTH_SSO_CODE_INVALID');
    }
  });

  describe('authorize 的 tenant 參數（D7）', () => {
    async function authorizeError(client: Client, overrides: Record<string, string | null>) {
      const query = authorizeQuery(client, pkce().challenge, 'x');
      for (const [key, value] of Object.entries(overrides)) {
        if (value === null) query.delete(key);
        else query.set(key, value);
      }
      const response = await idp('get', `/oidc/auth?${query.toString()}`);
      expect(response.status).toBe(303);
      return new URL(response.headers.location as string);
    }

    it('backstage 沒帶 tenant、帶了不存在的租戶 → 帶錯誤導回（已通過網域檢查的）redirect URI', async () => {
      for (const tenant of [null, 'no-such-tenant']) {
        const location = await authorizeError(BACKSTAGE, { tenant });
        expect(location.origin + location.pathname).toBe(BACKSTAGE.redirectUri);
        expect(location.searchParams.get('error')).toBe('invalid_request');
      }
    });

    it('tenant 與 redirect URI 的網域不是同一個租戶 → invalid_request', async () => {
      const location = await authorizeError(BACKSTAGE, { tenant: 'sso-b' });
      expect(location.searchParams.get('error')).toBe('invalid_request');
    });

    it('apps/platform 的 client 不能帶 tenant', async () => {
      const location = await authorizeError(AUTH_APP, { tenant: 'test' });
      expect(location.searchParams.get('error')).toBe('invalid_request');
    });

    it('redirect URI 不是任何租戶的網域 → apps/platform 的錯誤頁，絕不導回', async () => {
      const query = authorizeQuery(
        { ...BACKSTAGE, redirectUri: 'https://evil.example.com/auth/callback' },
        pkce().challenge,
        'x',
      );
      const response = await idp('get', `/oidc/auth?${query.toString()}`);
      expect(response.status).toBe(303);
      expect(response.headers.location).toBe(
        'http://localhost:5175/error?error=invalid_redirect_uri',
      );
    });
  });

  it('登入互動：帳密錯誤回 AUTH_INVALID_CREDENTIALS；沒有互動 cookie 回 AUTH_SSO_INTERACTION_INVALID', async () => {
    const jar = new CookieJar();
    const start = await idp(
      'get',
      `/oidc/auth?${authorizeQuery(BACKSTAGE, pkce().challenge, 'x').toString()}`,
    );
    jar.store(start);
    const uid = new URL(start.headers.location as string).pathname.split('/').pop()!;

    // 平台管理者的帳密在租戶的互動裡不存在
    const wrong = await idp('post', `/oidc-interaction/${uid}/login`)
      .set('cookie', jar.header())
      .send(PLATFORM_ADMIN)
      .expect(401);
    expect(errorCode(wrong)).toBe('AUTH_INVALID_CREDENTIALS');

    const noCookie = await idp('get', `/oidc-interaction/${uid}/details`).expect(400);
    expect(errorCode(noCookie)).toBe('AUTH_SSO_INTERACTION_INVALID');
  });

  describe('平台管理者（apps/platform，D5、D8）', () => {
    it('不帶租戶的登入互動查平台 DB；session 在 /platform/auth，token 沒有 tid', async () => {
      const jar = new CookieJar();
      const session = await callback(
        AUTH_APP,
        await authorize(jar, AUTH_APP, PLATFORM_ADMIN),
      ).expect(200);
      const token = tokenOf(session);
      expect(payloadOf(token)).toMatchObject({ realm: 'platform' });
      expect(payloadOf(token)).not.toHaveProperty('tid');
      expect(String(session.headers['set-cookie'])).toMatch(/Path=\/api\/platform\/auth/);

      const profile = await request(http)
        .get('/platform/auth/profile')
        .set('Host', AUTH_HOST)
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      expect((profile.body as { data: unknown }).data).toMatchObject({
        admin: { email: PLATFORM_ADMIN.email },
      });

      // 租戶網域不接受平台的 token；平台的端點在租戶網域不存在
      await request(http)
        .get('/auth/profile')
        .set('Host', BACKSTAGE.host)
        .set('authorization', `Bearer ${token}`)
        .expect(401);
      const onTenant = await request(http)
        .post('/platform/auth/sso/callback')
        .set('Host', BACKSTAGE.host)
        .send({
          code: 'x'.repeat(43),
          codeVerifier: 'y'.repeat(43),
          clientId: AUTH_APP.clientId,
          redirectUri: AUTH_APP.redirectUri,
        });
      expect(errorCode(onTenant)).toBe('PLATFORM_ONLY');
    });

    it('租戶的帳密在平台的互動裡不存在；租戶的 token 在 apps/platform 的網域無效', async () => {
      const jar = new CookieJar();
      const start = await idp(
        'get',
        `/oidc/auth?${authorizeQuery(AUTH_APP, pkce().challenge, 'x').toString()}`,
      );
      jar.store(start);
      const uid = new URL(start.headers.location as string).pathname.split('/').pop()!;
      const wrong = await idp('post', `/oidc-interaction/${uid}/login`)
        .set('cookie', jar.header())
        .send(USER)
        .expect(401);
      expect(errorCode(wrong)).toBe('AUTH_INVALID_CREDENTIALS');

      const tenantSession = await callback(
        BACKSTAGE,
        await authorize(new CookieJar(), BACKSTAGE, USER),
      );
      await request(http)
        .get('/platform/auth/profile')
        .set('Host', AUTH_HOST)
        .set('authorization', `Bearer ${tokenOf(tenantSession)}`)
        .expect(401);
    });

    it('refresh 輪替、登出一併結束 IdP session', async () => {
      const jar = new CookieJar();
      const session = await callback(
        AUTH_APP,
        await authorize(jar, AUTH_APP, PLATFORM_ADMIN),
      ).expect(200);
      const refreshed = await request(http)
        .post('/platform/auth/refresh')
        .set('Host', AUTH_HOST)
        .set('x-refresh-request', '1')
        .set('cookie', refreshCookieOf(session))
        .expect(200);
      // 舊的在寬限期過後再用一次 = 重用，整條家族撤銷（寬限期內的重送見 refresh-rotation.spec.ts）
      await platformDb
        .update(platformRefreshTokens)
        .set({ usedAt: new Date(Date.now() - 5 * 60_000) })
        .where(eq(platformRefreshTokens.tokenHash, sha256Of(refreshCookieOf(session))));
      const reused = await request(http)
        .post('/platform/auth/refresh')
        .set('Host', AUTH_HOST)
        .set('x-refresh-request', '1')
        .set('cookie', refreshCookieOf(session))
        .expect(401);
      expect(errorCode(reused)).toBe('AUTH_REFRESH_REUSED');

      const again = await callback(AUTH_APP, await authorize(jar, AUTH_APP, PLATFORM_ADMIN)).expect(
        200,
      );
      await request(http)
        .post('/platform/auth/logout')
        .set('Host', AUTH_HOST)
        .set('authorization', `Bearer ${tokenOf(again)}`)
        .set('cookie', refreshCookieOf(again))
        .expect(200);
      const [row] = await platformDb
        .select()
        .from(platformRefreshTokens)
        .where(eq(platformRefreshTokens.tokenHash, sha256Of(refreshCookieOf(again))));
      expect(row?.revokedReason).toBe('logout');
      await expect(authorize(jar, AUTH_APP)).rejects.toThrow(/卻被導去登入/);
      expect(tokenOf(refreshed)).toBeTruthy();
    });
  });

  it('帳號停用 → IdP session 一起結束；重新啟用後要重新登入（docs/architecture/04-sso.md §12.2 D17）', async () => {
    const jar = new CookieJar();
    await callback(BACKSTAGE, await authorize(jar, BACKSTAGE, USER)).expect(200);

    const login = await request(http)
      .post('/auth/login')
      .set('Host', BACKSTAGE.host)
      .send(SUPER_ADMIN)
      .expect(200);
    const admin = tokenOf(login);
    const setStatus = async (status: 'inactive' | 'active') =>
      request(http)
        .patch(`/users/${userId}`)
        .set('Host', BACKSTAGE.host)
        .set('authorization', `Bearer ${admin}`)
        .send({ status, version: await userVersion(db, userId) })
        .expect(200);

    await setStatus('inactive');
    await setStatus('active');
    // 同一個瀏覽器的 IdP session cookie 還在，但 session 已銷毀：不會直接拿到授權碼
    await expect(authorize(jar, BACKSTAGE)).rejects.toThrow(/卻被導去登入/);
  });

  it('租戶的公開資訊：/tenant/current 依網域；/tenants/lookup 以代碼找登入入口', async () => {
    const current = await request(http)
      .get('/tenant/current')
      .set('Host', BACKSTAGE_B.host)
      .expect(200);
    expect((current.body as { data: unknown }).data).toEqual({ code: 'sso-b', name: '租戶 sso-b' });
    await request(http).get('/tenant/current').set('Host', AUTH_HOST).expect(404);

    const lookup = await idp('get', '/tenants/lookup?code=sso-b').expect(200);
    expect((lookup.body as { data: unknown }).data).toMatchObject({
      code: 'sso-b',
      loginUrl: 'http://sso-b.test/auth/login',
    });
    const missing = await idp('get', '/tenants/lookup?code=nope').expect(404);
    expect(errorCode(missing)).toBe('TENANT_NOT_FOUND');
  });

  it('apps/platform 的帳號流程以 X-Tenant 指定租戶；租戶網域上 X-Tenant 不能換租戶', async () => {
    const forgot = (host: string, tenant?: string) => {
      const req = request(http)
        .post('/auth/forgot-password')
        .set('Host', host)
        .send({ email: 'nobody@example.com' });
      return tenant ? req.set('X-Tenant', tenant) : req;
    };
    // 沒有租戶：需要租戶 DB 的端點不存在
    expect(errorCode(await forgot(AUTH_HOST).expect(404))).toBe('TENANT_NOT_FOUND');
    await forgot(AUTH_HOST, 'sso-b').expect(200);
    // 租戶網域上以網域為準：帶了不存在的租戶代碼也一樣在自己的租戶執行
    await forgot(BACKSTAGE.host, 'no-such-tenant').expect(200);
  });
});

function sha256Of(cookie: string): string {
  return createHash('sha256').update(cookie.slice('refresh_token='.length)).digest('hex');
}
