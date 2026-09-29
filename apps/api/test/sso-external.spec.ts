import { createHash, randomBytes } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ObjectStorage } from '@/core/storage';
import { identityProviders, roles, userIdentities, userRoles, users } from '@/db/schema';
import { ExternalOidcClient } from '@/modules/identity-provider/external-oidc.client';
import type {
  ExternalIdentity,
  ExternalProviderConfig,
} from '@/modules/identity-provider/external-oidc.client';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';
import { InMemoryObjectStorage } from './in-memory-object-storage';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;

const SUPER_ADMIN = { email: 'ext-root@example.com', password: 'RootPassword!2026' };
const MEMBER = { email: 'ext-member@example.com', password: 'MemberPassword!2026' };
const ALICE = 'alice@acme.test';
const BACKSTAGE = { clientId: 'backstage', redirectUri: 'http://localhost:5173/auth/callback' };

async function roleIdOf(slug: string): Promise<string> {
  const [role] = await db.select().from(roles).where(eq(roles.slug, slug));
  return role!.id;
}

/**
 * 假的外部 IdP：授權網址帶回 state；兌換時回傳測試指定的身分（`nextIdentity`），並記下收到的參數。
 * 真的協定由 openid-client 負責，這裡測的是我們的流程與帳號對應。
 */
class FakeExternalOidcClient extends ExternalOidcClient {
  nextIdentity: ExternalIdentity | Error = new Error('沒有設定身分');
  exchanges: Array<{ provider: ExternalProviderConfig; currentUrl: string }> = [];

  authorizationUrl(
    provider: ExternalProviderConfig,
    params: { redirectUri: string; state: string; nonce: string; codeChallenge: string },
  ): Promise<string> {
    const url = new URL('https://idp.test/authorize');
    url.search = new URLSearchParams({
      client_id: provider.clientId,
      redirect_uri: params.redirectUri,
      state: params.state,
    }).toString();
    return Promise.resolve(url.toString());
  }

  exchange(
    provider: ExternalProviderConfig,
    params: { currentUrl: string },
  ): Promise<ExternalIdentity> {
    this.exchanges.push({ provider, currentUrl: params.currentUrl });
    return this.nextIdentity instanceof Error
      ? Promise.reject(this.nextIdentity)
      : Promise.resolve(this.nextIdentity);
  }
}

const external = new FakeExternalOidcClient();

class CookieJar {
  private readonly cookies = new Map<string, string>();

  store(response: request.Response): void {
    const header = response.headers['set-cookie'] as string[] | string | undefined;
    for (const line of Array.isArray(header) ? header : header ? [header] : []) {
      const [pair] = line.split(';');
      const index = pair!.indexOf('=');
      const value = pair!.slice(index + 1);
      if (value === '' || /expires=Thu, 01 Jan 1970/i.test(line))
        this.cookies.delete(pair!.slice(0, index));
      else this.cookies.set(pair!.slice(0, index), value);
    }
  }

  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

function internalPath(url: string): string {
  const { pathname, search } = new URL(url);
  return pathname.replace(/^\/api/, '') + search;
}

function errorCode(response: request.Response): string | undefined {
  return (response.body as { error?: { code?: string } }).error?.code;
}

async function token(credentials: { email: string; password: string }): Promise<string> {
  const response = await request(http).post('/auth/login').send(credentials).expect(200);
  return (response.body as { data: { accessToken: string } }).data.accessToken;
}

/** 開始一次授權，停在登入互動；回傳互動 id、cookie 與 PKCE verifier。 */
async function beginInteraction() {
  const jar = new CookieJar();
  const verifier = randomBytes(32).toString('base64url');
  const query = new URLSearchParams({
    client_id: BACKSTAGE.clientId,
    redirect_uri: BACKSTAGE.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: 'product-state',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  });
  const start = await request(http).get(`/oidc/auth?${query.toString()}`).expect(303);
  jar.store(start);
  const uid = new URL(start.headers.location as string).pathname.split('/').pop()!;
  return { jar, uid, verifier };
}

/** 互動頁按「以 X 登入」→ 外部 IdP 帶授權碼回到 callback；回傳 callback 的跳轉目標。 */
async function loginExternally(
  interaction: { jar: CookieJar; uid: string },
  providerId: string,
): Promise<string> {
  const started = await request(http)
    .post(`/oidc-interaction/${interaction.uid}/external`)
    .set('cookie', interaction.jar.header())
    .send({ providerId })
    .expect(200);
  const redirectTo = (started.body as { data: { redirectTo: string } }).data.redirectTo;
  const state = new URL(redirectTo).searchParams.get('state')!;
  // 外部 IdP 跳回來（不帶任何 apps/auth 的 cookie：固定路徑的 callback 不需要）
  const back = await request(http)
    .get(`/oidc-interaction/external/callback?code=external-code&state=${state}`)
    .expect(302);
  return back.headers.location as string;
}

/** complete → resume → 產品的授權碼 → BFF；回傳 app session 的使用者 id。 */
async function finishToProduct(
  interaction: { jar: CookieJar; verifier: string },
  completeUrl: string,
): Promise<string> {
  const complete = await request(http)
    .get(internalPath(completeUrl))
    .set('cookie', interaction.jar.header())
    .expect(303);
  const resume = await request(http)
    .get(internalPath(complete.headers.location as string))
    .set('cookie', interaction.jar.header())
    .expect(303);
  const code = new URL(resume.headers.location as string).searchParams.get('code')!;
  const session = await request(http)
    .post('/auth/sso/callback')
    .send({
      code,
      codeVerifier: interaction.verifier,
      clientId: BACKSTAGE.clientId,
      redirectUri: BACKSTAGE.redirectUri,
    })
    .expect(200);
  const accessToken = (session.body as { data: { accessToken: string } }).data.accessToken;
  const profile = await request(http)
    .get('/auth/profile')
    .set('authorization', `Bearer ${accessToken}`)
    .expect(200);
  return (profile.body as { data: { user: { id: string } } }).data.user.id;
}

async function createProvider(
  body: Record<string, unknown>,
): Promise<{ id: string; callbackUrl: string }> {
  const admin = await token(SUPER_ADMIN);
  const created = await request(http)
    .post('/identity-providers')
    .set('authorization', `Bearer ${admin}`)
    .send({ issuer: 'https://idp.test', clientId: 'b2b', clientSecret: 'top-secret', ...body })
    .expect(201);
  const list = await request(http)
    .get('/identity-providers')
    .set('authorization', `Bearer ${admin}`)
    .expect(200);
  return {
    id: (created.body as { data: { id: string } }).data.id,
    callbackUrl: (list.body as { data: { callbackUrl: string } }).data.callbackUrl,
  };
}

describe('外部 IdP 登入（docs/adr/0019-sso-identity-platform.md D8–D11）', () => {
  let aliceId = '';

  beforeAll(async () => {
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
    const insert = async (email: string, password: string | null) => {
      const [row] = await db
        .insert(users)
        .values({
          email,
          displayName: email,
          passwordHash: password ? await hashPassword(password) : null,
          status: 'active',
        })
        .returning();
      return row!.id;
    };
    const memberId = await insert(MEMBER.email, MEMBER.password);
    await db.insert(userRoles).values({ userId: memberId, roleId: await roleIdOf('member') });
    aliceId = await insert(ALICE, 'AlicePassword!2026');

    const { AppModule } = await import('@/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ObjectStorage)
      .useValue(new InMemoryObjectStorage())
      .overrideProvider(ExternalOidcClient)
      .useValue(external)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.use(cookieParser());
    await app.init();
    http = app.getHttpServer() as App;
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    delete process.env.AUTH_RATE_LIMIT;
  });

  beforeEach(() => {
    external.exchanges = [];
  });

  describe('連線管理', () => {
    it('client secret 加密存放、不回傳；redirect URI 是固定的 callback', async () => {
      const { id, callbackUrl } = await createProvider({
        name: 'Acme',
        domains: [{ domain: 'ACME.test', ssoOnly: true }],
      });
      expect(callbackUrl).toBe('http://localhost:5175/api/oidc-interaction/external/callback');

      const [row] = await db.select().from(identityProviders).where(eq(identityProviders.id, id));
      expect(row?.clientSecretEncrypted).not.toContain('top-secret');

      const admin = await token(SUPER_ADMIN);
      const list = await request(http)
        .get('/identity-providers')
        .set('authorization', `Bearer ${admin}`)
        .expect(200);
      const text = JSON.stringify(list.body);
      expect(text).not.toContain('top-secret');
      expect(text).not.toContain('clientSecret');
      expect(text).toContain('"domain":"acme.test"');
    });

    it('網域已屬於別的連線 → IDENTITY_PROVIDER_DOMAIN_TAKEN；沒有權限 → 403', async () => {
      const admin = await token(SUPER_ADMIN);
      const taken = await request(http)
        .post('/identity-providers')
        .set('authorization', `Bearer ${admin}`)
        .send({
          name: 'Acme 2',
          issuer: 'https://idp.test',
          clientId: 'b2b',
          clientSecret: 'x',
          domains: [{ domain: 'acme.test', ssoOnly: false }],
        })
        .expect(409);
      expect(errorCode(taken)).toBe('IDENTITY_PROVIDER_DOMAIN_TAKEN');

      const member = await token(MEMBER);
      await request(http)
        .get('/identity-providers')
        .set('authorization', `Bearer ${member}`)
        .expect(403);
    });
  });

  describe('只允許 SSO 的網域（D9）', () => {
    it('密碼登入被擋下（AUTH_SSO_REQUIRED），不論帳號是否存在', async () => {
      for (const email of [ALICE, 'nobody@acme.test']) {
        const response = await request(http)
          .post('/auth/login')
          .send({ email, password: 'AlicePassword!2026' })
          .expect(403);
        expect(errorCode(response)).toBe('AUTH_SSO_REQUIRED');
      }
    });

    it('網域導向：互動頁以 email 查得到連線與 ssoOnly', async () => {
      const interaction = await beginInteraction();
      const found = await request(http)
        .get(`/oidc-interaction/${interaction.uid}/discover?email=${encodeURIComponent(ALICE)}`)
        .set('cookie', interaction.jar.header())
        .expect(200);
      expect((found.body as { data: unknown }).data).toMatchObject({
        provider: { name: 'Acme' },
        ssoOnly: true,
      });
      const none = await request(http)
        .get(`/oidc-interaction/${interaction.uid}/discover?email=someone@other.test`)
        .set('cookie', interaction.jar.header())
        .expect(200);
      expect((none.body as { data: unknown }).data).toEqual({ provider: null, ssoOnly: false });
    });
  });

  describe('外部登入與帳號對應', () => {
    let acmeId = '';

    beforeAll(async () => {
      const [row] = await db
        .select()
        .from(identityProviders)
        .where(eq(identityProviders.name, 'Acme'));
      acmeId = row!.id;
    });

    it('已驗證的 email 對上既有帳號 → 連結並登入；回到產品拿到 app session', async () => {
      external.nextIdentity = {
        subject: 'acme-sub-1',
        email: ALICE,
        emailVerified: true,
        name: 'Alice',
      };
      const interaction = await beginInteraction();
      const next = await loginExternally(interaction, acmeId);
      expect(next).toMatch(
        new RegExp(
          `^http://localhost:5175/api/oidc-interaction/${interaction.uid}/external/complete\\?ticket=`,
        ),
      );
      expect(external.exchanges[0]?.currentUrl).toMatch(
        /^http:\/\/localhost:5175\/api\/oidc-interaction\/external\/callback\?code=external-code&state=/,
      );
      expect(external.exchanges[0]?.provider.clientSecret).toBe('top-secret');

      expect(await finishToProduct(interaction, next)).toBe(aliceId);
      const [identity] = await db
        .select()
        .from(userIdentities)
        .where(
          and(eq(userIdentities.providerId, acmeId), eq(userIdentities.subject, 'acme-sub-1')),
        );
      expect(identity?.userId).toBe(aliceId);
    });

    it('之後以 subject 對應：即使 email 變了、甚至沒有 email，還是同一個帳號', async () => {
      external.nextIdentity = {
        subject: 'acme-sub-1',
        email: null,
        emailVerified: false,
        name: null,
      };
      const interaction = await beginInteraction();
      const next = await loginExternally(interaction, acmeId);
      expect(await finishToProduct(interaction, next)).toBe(aliceId);
    });

    it('沒有對應帳號、連線設為拒絕 → 回到互動頁並帶 AUTH_SSO_ACCOUNT_NOT_FOUND', async () => {
      external.nextIdentity = {
        subject: 'acme-sub-2',
        email: 'bob@acme.test',
        emailVerified: true,
        name: 'Bob',
      };
      const interaction = await beginInteraction();
      expect(await loginExternally(interaction, acmeId)).toBe(
        `http://localhost:5175/interaction/${interaction.uid}?error=AUTH_SSO_ACCOUNT_NOT_FOUND`,
      );
    });

    it('未驗證的 email 不能拿來對應既有帳號', async () => {
      external.nextIdentity = {
        subject: 'acme-sub-3',
        email: MEMBER.email,
        emailVerified: false,
        name: null,
      };
      const interaction = await beginInteraction();
      expect(await loginExternally(interaction, acmeId)).toContain(
        'error=AUTH_SSO_ACCOUNT_NOT_FOUND',
      );
    });

    it('auto_create：登記過的網域才建立帳號（沒有任何角色）', async () => {
      const { id } = await createProvider({
        name: 'Beta',
        unmatchedPolicy: 'auto_create',
        domains: [{ domain: 'beta.test', ssoOnly: false }],
      });

      external.nextIdentity = {
        subject: 'beta-1',
        email: 'carol@beta.test',
        emailVerified: true,
        name: 'Carol',
      };
      const interaction = await beginInteraction();
      const userId = await finishToProduct(interaction, await loginExternally(interaction, id));
      const [carol] = await db.select().from(users).where(eq(users.id, userId));
      expect(carol).toMatchObject({
        email: 'carol@beta.test',
        displayName: 'Carol',
        status: 'active',
      });
      expect(await db.select().from(userRoles).where(eq(userRoles.userId, userId))).toEqual([]);

      // 別的網域（例：一般 gmail）不會因為這個連線被自動建立
      external.nextIdentity = {
        subject: 'beta-2',
        email: 'dave@gmail.test',
        emailVerified: true,
        name: 'Dave',
      };
      const other = await beginInteraction();
      expect(await loginExternally(other, id)).toContain('error=AUTH_SSO_ACCOUNT_NOT_FOUND');
    });

    it('state 只能用一次；兌換失敗回到互動頁', async () => {
      external.nextIdentity = new Error('invalid_grant');
      const interaction = await beginInteraction();
      expect(await loginExternally(interaction, acmeId)).toContain(
        'error=AUTH_SSO_EXTERNAL_FAILED',
      );

      const unknown = await request(http)
        .get('/oidc-interaction/external/callback?code=x&state=unknown-state-123')
        .expect(302);
      expect(unknown.headers.location).toBe(
        'http://localhost:5175/error?error=AUTH_SSO_EXTERNAL_FAILED',
      );
    });
  });
});
