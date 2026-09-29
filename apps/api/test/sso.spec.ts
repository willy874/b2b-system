import { createHash, randomBytes } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { ObjectStorage } from '@/core/storage';
import { refreshTokens, users } from '@/db/schema';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';
import { InMemoryObjectStorage } from './in-memory-object-storage';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;

const SUPER_ADMIN = { email: 'sso-root@example.com', password: 'RootPassword!2026' };
const USER = { email: 'sso-user@example.com', password: 'SsoUserPassword!2026' };

/** 與 env 預設值一致（apps/auth :5175、backstage :5173）。 */
const ISSUER_PATH = '/api/oidc';
const BACKSTAGE = { clientId: 'backstage', redirectUri: 'http://localhost:5173/auth/callback' };
const AUTH_APP = { clientId: 'auth', redirectUri: 'http://localhost:5175/callback' };

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

/** `/oidc/auth`：已有 IdP session 時直接帶授權碼導回；否則走登入互動（`credentials` 必填）。 */
async function authorize(
  jar: CookieJar,
  client: { clientId: string; redirectUri: string },
  credentials?: { email: string; password: string },
): Promise<Authorized> {
  const { verifier, challenge } = pkce();
  const state = randomBytes(8).toString('hex');
  const query = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  let response = await request(http)
    .get(`/oidc/auth?${query.toString()}`)
    .set('cookie', jar.header());
  jar.store(response);
  let location = response.headers.location as string;
  expect(response.status).toBe(303);

  if (location.includes('/oidc-interaction/')) {
    if (!credentials) throw new Error(`預期已有 IdP session，卻被導去登入：${location}`);
    const uid = new URL(location).pathname.split('/').pop()!;

    // 互動網址先到 api，再轉到 apps/auth 的頁面
    const toPage = await request(http).get(internalPath(location));
    expect(toPage.status).toBe(302);
    expect(toPage.headers.location).toBe(`http://localhost:5175/interaction/${uid}`);

    const details = await request(http)
      .get(`/oidc-interaction/${uid}/details`)
      .set('cookie', jar.header())
      .expect(200);
    expect((details.body as { data: unknown }).data).toMatchObject({
      uid,
      prompt: 'login',
      clientId: client.clientId,
    });

    const login = await request(http)
      .post(`/oidc-interaction/${uid}/login`)
      .set('cookie', jar.header())
      .send(credentials)
      .expect(200);
    const redirectTo = (login.body as { data: { redirectTo: string } }).data.redirectTo;
    expect(redirectTo).toBe(`http://localhost:5175${ISSUER_PATH}/auth/${uid}`);

    // 頂層跳轉回 provider 的 resume：建立 IdP session，帶授權碼導回產品
    response = await request(http).get(internalPath(redirectTo)).set('cookie', jar.header());
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

function callback(
  client: { clientId: string; redirectUri: string },
  authorized: Authorized,
): request.Test {
  return request(http).post('/auth/sso/callback').send({
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

describe('SSO（docs/adr/0019-sso-identity-platform.md）', () => {
  let userId = '';

  beforeAll(async () => {
    process.env.DATABASE_URL = inject('databaseUrl');
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN.email;
    process.env.SUPER_ADMIN_PASSWORD = SUPER_ADMIN.password;
    process.env.AUTH_RATE_LIMIT = '1000';

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);

    const { hashPassword } = await import('@/modules/auth/password');
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

    const { AppModule } = await import('@/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ObjectStorage)
      .useValue(new InMemoryObjectStorage())
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    // 與 main.ts 相同：refresh 與 logout 從 cookie 讀 refresh token
    app.use(cookieParser());
    await app.init();
    http = app.getHttpServer() as App;
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    delete process.env.AUTH_RATE_LIMIT;
  });

  it('discovery 的網址都是瀏覽器看到的（apps/auth origin ＋ /api/oidc）', async () => {
    const response = await request(http).get('/oidc/.well-known/openid-configuration').expect(200);
    const body = response.body as { issuer: string; authorization_endpoint: string };
    expect(body.issuer).toBe(`http://localhost:5175${ISSUER_PATH}`);
    expect(body.authorization_endpoint).toBe(`http://localhost:5175${ISSUER_PATH}/auth`);
  });

  it('登入一次 → 兩個產品都拿到各自的 app session；單一登出結束兩邊', async () => {
    const jar = new CookieJar();

    // backstage：沒有 IdP session → 登入互動
    const first = await authorize(jar, BACKSTAGE, USER);
    const backstage = await callback(BACKSTAGE, first).expect(200);
    const backstageToken = (backstage.body as { data: { accessToken: string } }).data.accessToken;
    const backstageRefresh = refreshCookieOf(backstage);
    // host-only：不設 Domain（D6）
    expect(String(backstage.headers['set-cookie'])).not.toMatch(/domain=/i);

    // apps/auth：已有 IdP session → 不出現登入頁，直接拿到授權碼
    const second = await authorize(jar, AUTH_APP);
    const account = await callback(AUTH_APP, second).expect(200);
    const accountRefresh = refreshCookieOf(account);

    const rows = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, userId));
    expect(new Set(rows.map((row) => row.clientId))).toEqual(new Set(['backstage', 'auth']));
    const [sessionUid] = new Set(rows.map((row) => row.idpSessionUid));
    expect(sessionUid).toBeTruthy();
    expect(rows.every((row) => row.idpSessionUid === sessionUid)).toBe(true);

    // access token 帶 sid（即時連線依它加入 IdP session 的 room）
    const [, payload] = backstageToken.split('.');
    expect(JSON.parse(Buffer.from(payload!, 'base64url').toString())).toMatchObject({
      sub: userId,
      sid: sessionUid,
    });

    // 在 backstage 登出
    await request(http)
      .post('/auth/logout')
      .set('authorization', `Bearer ${backstageToken}`)
      .set('cookie', backstageRefresh)
      .expect(200);

    // apps/auth 的 refresh 也被撤銷
    const refreshed = await request(http)
      .post('/auth/refresh')
      .set('x-refresh-request', '1')
      .set('cookie', accountRefresh)
      .expect(401);
    expect(errorCode(refreshed)).toBe('AUTH_REFRESH_REVOKED');

    // IdP session 已銷毀：再授權要重新登入
    const again = await authorize(jar, BACKSTAGE, USER);
    await callback(BACKSTAGE, again).expect(200);
  });

  it('授權碼只能兌換一次；PKCE、client、redirect URI 不符一律 AUTH_SSO_CODE_INVALID', async () => {
    const jar = new CookieJar();
    const authorized = await authorize(jar, BACKSTAGE, USER);

    const wrongVerifier = await request(http)
      .post('/auth/sso/callback')
      .send({
        code: authorized.code,
        codeVerifier: pkce().verifier,
        clientId: BACKSTAGE.clientId,
        redirectUri: BACKSTAGE.redirectUri,
      })
      .expect(400);
    expect(errorCode(wrongVerifier)).toBe('AUTH_SSO_CODE_INVALID');

    const wrongClient = await callback(AUTH_APP, authorized).expect(400);
    expect(errorCode(wrongClient)).toBe('AUTH_SSO_CODE_INVALID');

    await callback(BACKSTAGE, authorized).expect(200);
    const replay = await callback(BACKSTAGE, authorized).expect(400);
    expect(errorCode(replay)).toBe('AUTH_SSO_CODE_INVALID');
  });

  it('登入互動：帳密錯誤回 AUTH_INVALID_CREDENTIALS；沒有互動 cookie 回 AUTH_SSO_INTERACTION_INVALID', async () => {
    const jar = new CookieJar();
    const { challenge } = pkce();
    const query = new URLSearchParams({
      client_id: BACKSTAGE.clientId,
      redirect_uri: BACKSTAGE.redirectUri,
      response_type: 'code',
      scope: 'openid',
      state: 'x',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    const start = await request(http).get(`/oidc/auth?${query.toString()}`);
    jar.store(start);
    const uid = new URL(start.headers.location as string).pathname.split('/').pop()!;

    const wrong = await request(http)
      .post(`/oidc-interaction/${uid}/login`)
      .set('cookie', jar.header())
      .send({ email: USER.email, password: 'wrong-password-123' })
      .expect(401);
    expect(errorCode(wrong)).toBe('AUTH_INVALID_CREDENTIALS');

    const noCookie = await request(http).get(`/oidc-interaction/${uid}/details`).expect(400);
    expect(errorCode(noCookie)).toBe('AUTH_SSO_INTERACTION_INVALID');
  });

  it('沒註冊的 redirect URI 不會被導過去（白名單，D7）', async () => {
    const { challenge } = pkce();
    const query = new URLSearchParams({
      client_id: BACKSTAGE.clientId,
      redirect_uri: 'https://evil.example.com/callback',
      response_type: 'code',
      scope: 'openid',
      state: 'x',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    const response = await request(http).get(`/oidc/auth?${query.toString()}`);
    // 錯誤頁在 apps/auth，絕不導回未註冊的網址
    expect(response.status).toBe(303);
    expect(response.headers.location).toBe(
      'http://localhost:5175/error?error=invalid_redirect_uri',
    );
  });
});
