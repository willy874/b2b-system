import { createHash, randomBytes } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ObjectStorage } from '@/core/storage';
import { mfaMethodOverrides, mfaMethodSettings, platformAdmins } from '@/db/platform/schema';
import {
  auditLogs,
  identityProviders,
  relationTuples,
  roleHolderTuple,
  roles,
  userIdentities,
  users,
} from '@/db/schema';
import { upsertPlatformAdmin } from '@/db/seeds/platform-admin';
import { MfaMethodOverrideService } from '@/modules/mfa/mfa-method-override.service';
import { MfaMethodSettingsService } from '@/modules/mfa/mfa-method-settings.service';

import { createMockSamlIdp } from '../scripts/mock-saml-idp';
import type { MockSamlIdp } from '../scripts/mock-saml-idp';
import type { PlatformTestDatabase, TestDatabase } from './db';
import { createPlatformTestDatabase, createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { InMemoryObjectStorage } from './in-memory-object-storage';
import { SoftAuthenticator } from './soft-authenticator';

/**
 * 更多的登入方式（docs/architecture/04-sso.md §3.3.1–§3.3.4、§3.6）：OIDC 範本、SAML 2.0（以真的簽章驗證）、
 * 帳號的外部身分、通行金鑰取代密碼（以軟體驗證器做出真的 WebAuthn 回應）。
 */

let app: INestApplication;
let http: App;
let db: TestDatabase;
let platformDb: PlatformTestDatabase;
let samlIdp: MockSamlIdp;
const closers: Array<() => Promise<void>> = [];

const PASSWORD = 'Sso-Methods!Pass2026';
const SUPER_ADMIN = { email: 'sso-methods-root@example.com', password: 'Quiet-Harbor-Lantern-26' };
const PLATFORM_ADMIN = {
  email: 'sso-methods-platform@example.com',
  password: 'PlatformPassword!2026',
};
const AUTH_HOST = 'localhost:5175';
const PLATFORM_ORIGIN = 'http://localhost:5175';

interface Client {
  clientId: string;
  redirectUri: string;
  tenant?: string;
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
const AUTH_APP: Client = {
  clientId: 'auth',
  redirectUri: 'http://localhost:5175/callback',
  host: AUTH_HOST,
  callbackPath: '/platform/auth/sso/callback',
};

function idp(method: 'get' | 'post', path: string): request.Test {
  return request(http)[method](path).set('Host', AUTH_HOST);
}

class CookieJar {
  private readonly cookies = new Map<string, { value: string; attributes: string }>();

  store(response: request.Response): void {
    const header = response.headers['set-cookie'] as string[] | string | undefined;
    for (const line of Array.isArray(header) ? header : header ? [header] : []) {
      const [pair, ...attributes] = line.split(';');
      const index = pair!.indexOf('=');
      const name = pair!.slice(0, index);
      const value = pair!.slice(index + 1);
      if (value === '' || /expires=Thu, 01 Jan 1970/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, { value, attributes: attributes.join(';') });
    }
  }

  attributesOf(prefix: string): string | undefined {
    return [...this.cookies].find(([name]) => name.startsWith(prefix))?.[1].attributes;
  }

  header(): string {
    return [...this.cookies].map(([name, { value }]) => `${name}=${value}`).join('; ');
  }
}

function internalPath(url: string): string {
  const { pathname, search } = new URL(url);
  return pathname.replace(/^\/api/, '') + search;
}

function errorCode(response: request.Response): string | undefined {
  return (response.body as { error?: { code?: string } }).error?.code;
}

function dataOf<T>(response: request.Response): T {
  return (response.body as { data: T }).data;
}

interface Interaction {
  jar: CookieJar;
  uid: string;
  client: Client;
  verifier: string;
}

async function startInteraction(
  client: Client = BACKSTAGE,
  extra: Record<string, string> = {},
): Promise<Interaction> {
  const jar = new CookieJar();
  const verifier = randomBytes(32).toString('base64url');
  const query = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: randomBytes(8).toString('hex'),
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    ...extra,
  });
  if (client.tenant) query.set('tenant', client.tenant);
  const response = await idp('get', `/oidc/auth?${query.toString()}`);
  jar.store(response);
  const location = response.headers.location as string;
  expect(location).toContain('/oidc-interaction/');
  return { jar, uid: new URL(location).pathname.split('/').pop()!, client, verifier };
}

function interactionPost(interaction: Interaction, path: string, body: object = {}): request.Test {
  return idp('post', `/oidc-interaction/${interaction.uid}${path}`)
    .set('cookie', interaction.jar.header())
    .send(body);
}

/** resume → 產品的授權碼 → BFF；回傳 access token。 */
async function finish(interaction: Interaction, redirectTo: string): Promise<string> {
  const resume = await idp('get', internalPath(redirectTo)).set('cookie', interaction.jar.header());
  interaction.jar.store(resume);
  expect(resume.status).toBe(303);
  const code = new URL(resume.headers.location as string).searchParams.get('code');
  if (!code) throw new Error(`沒有授權碼：${String(resume.headers.location)}`);
  const { client } = interaction;
  const session = await request(http)
    .post(client.callbackPath)
    .set('Host', client.host)
    .send({
      code,
      codeVerifier: interaction.verifier,
      clientId: client.clientId,
      redirectUri: client.redirectUri,
    })
    .expect(200);
  return dataOf<{ accessToken: string }>(session).accessToken;
}

async function profileEmail(accessToken: string, host = BACKSTAGE.host): Promise<string> {
  const response = await request(http)
    .get(host === AUTH_HOST ? '/platform/auth/profile' : '/auth/profile')
    .set('Host', host)
    .set('authorization', `Bearer ${accessToken}`)
    .expect(200);
  const data = dataOf<{ user?: { email: string }; admin?: { email: string } }>(response);
  return data.user?.email ?? data.admin?.email ?? '';
}

async function createUser(email: string, password: string | null = PASSWORD): Promise<string> {
  const { hashPassword } = await import('@/modules/credential/password');
  const [user] = await db
    .insert(users)
    .values({
      email,
      displayName: email,
      passwordHash: password ? await hashPassword(password) : null,
      status: 'active',
    })
    .returning({ id: users.id });
  return user!.id;
}

async function tokenOf(credentials: { email: string; password: string }): Promise<string> {
  const response = await request(http).post('/auth/login').send(credentials).expect(200);
  return dataOf<{ accessToken: string }>(response).accessToken;
}

const superAdminToken = () => tokenOf(SUPER_ADMIN);

async function platformToken(): Promise<string> {
  const interaction = await startInteraction(AUTH_APP);
  const login = await interactionPost(interaction, '/login', PLATFORM_ADMIN).expect(200);
  return finish(interaction, dataOf<{ redirectTo: string }>(login).redirectTo);
}

function platform(method: 'get' | 'put', path: string, token: string): request.Test {
  return request(http)[method](path).set('Host', AUTH_HOST).set('authorization', `Bearer ${token}`);
}

describe('更多的登入方式（docs/architecture/04-sso.md §3.3、§3.6）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN.email;
    process.env.SUPER_ADMIN_PASSWORD = SUPER_ADMIN.password;
    process.env.AUTH_RATE_LIMIT = '1000';

    samlIdp = await createMockSamlIdp('https://saml-idp.test');

    const created = createTestDatabase();
    db = created.db;
    closers.push(async () => created.client.end());
    await truncateAll(db);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);

    const platformDatabase = createPlatformTestDatabase();
    platformDb = platformDatabase.db;
    closers.push(async () => platformDatabase.client.end());
    await platformDb.delete(platformAdmins).where(eq(platformAdmins.email, PLATFORM_ADMIN.email));
    await upsertPlatformAdmin(platformDb, { displayName: '平台管理者', ...PLATFORM_ADMIN });
    await platformDb.delete(mfaMethodOverrides);
    await platformDb.delete(mfaMethodSettings);

    const { AppModule } = await import('@/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ObjectStorage)
      .useValue(new InMemoryObjectStorage())
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.use(cookieParser());
    await app.init();
    http = await listenOnLoopback(app);
  });

  afterAll(async () => {
    await platformDb.delete(mfaMethodOverrides);
    await platformDb.delete(mfaMethodSettings);
    await app.close();
    for (const close of closers) await close();
    delete process.env.AUTH_RATE_LIMIT;
  });

  // ── OIDC 範本 ─────────────────────────────────────────────

  describe('OIDC 範本（§3.3.1）', () => {
    it('Entra 的 issuer 必須是單一目錄的 v2 端點；不帶 protocol 時是 OIDC（舊的呼叫端照舊）', async () => {
      const admin = await superAdminToken();
      const common = { name: 'Entra', clientId: 'c', clientSecret: 's', preset: 'microsoft' };
      const rejected = await request(http)
        .post('/identity-providers')
        .set('authorization', `Bearer ${admin}`)
        .send({ ...common, issuer: 'https://login.microsoftonline.com/common/v2.0' })
        .expect(400);
      expect(errorCode(rejected)).toBe('IDENTITY_PROVIDER_ISSUER_INVALID');

      const created = dataOf<{ protocol: string; preset: string; saml: unknown }>(
        await request(http)
          .post('/identity-providers')
          .set('authorization', `Bearer ${admin}`)
          .send({
            ...common,
            issuer: 'https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0',
          })
          .expect(201),
      );
      expect(created).toMatchObject({ protocol: 'oidc', preset: 'microsoft', saml: null });
    });
  });

  // ── SAML 2.0 ─────────────────────────────────────────────

  describe('SAML 2.0（§3.3.2）', () => {
    let providerId = '';
    let spEntityId = '';
    const SAML_DOMAIN = 'saml-corp.test';

    async function createSamlProvider(
      body: Record<string, unknown> = {},
      status = 201,
    ): Promise<request.Response> {
      const admin = await superAdminToken();
      return request(http)
        .post('/identity-providers')
        .set('authorization', `Bearer ${admin}`)
        .send({
          protocol: 'saml',
          name: 'Corp SAML',
          entityId: samlIdp.entityId,
          ssoUrl: samlIdp.ssoUrl,
          certificates: [samlIdp.certificate],
          unmatchedPolicy: 'auto_create',
          domains: [{ domain: SAML_DOMAIN, ssoOnly: false }],
          ...body,
        })
        .expect(status);
    }

    /** 互動頁按「以 Corp SAML 登入」：回傳 AuthnRequest 的 ID 與 RelayState。 */
    async function startSaml(interaction: Interaction) {
      const started = await interactionPost(interaction, '/external', { providerId }).expect(200);
      interaction.jar.store(started);
      const url = new URL(dataOf<{ redirectTo: string }>(started).redirectTo);
      expect(`${url.origin}${url.pathname}`).toBe(samlIdp.ssoUrl);
      const xml = inflateRawSync(
        Buffer.from(url.searchParams.get('SAMLRequest') ?? '', 'base64'),
      ).toString();
      return {
        requestId: /\sID="([^"]+)"/.exec(xml)![1]!,
        relayState: url.searchParams.get('RelayState')!,
      };
    }

    /** IdP 讓瀏覽器把回應 POST 到 ACS（跨站的表單）。回傳跳轉目標。 */
    async function postAcs(samlResponse: string, relayState: string, cookie: string) {
      const response = await idp('post', '/oidc-interaction/external/saml/acs')
        .type('form')
        .set('cookie', cookie)
        .send({ SAMLResponse: samlResponse, RelayState: relayState })
        .expect(303);
      return response.headers.location as string;
    }

    function responseFor(requestId: string, email: string, overrides = {}) {
      return samlIdp.buildResponse({
        inResponseTo: requestId,
        acsUrl: `${PLATFORM_ORIGIN}/api/oidc-interaction/external/saml/acs`,
        audience: spEntityId,
        nameId: `nameid-${email}`,
        email,
        name: email.split('@')[0],
        ...overrides,
      });
    }

    async function completeLogin(interaction: Interaction, location: string): Promise<string> {
      expect(location).toContain(`/oidc-interaction/${interaction.uid}/external/complete?ticket=`);
      const complete = await idp('get', internalPath(location))
        .set('cookie', interaction.jar.header())
        .expect(303);
      return finish(interaction, complete.headers.location as string);
    }

    it('憑證不是 X.509 → IDENTITY_PROVIDER_CERTIFICATE_INVALID（第幾張）', async () => {
      const response = await createSamlProvider(
        { certificates: [samlIdp.certificate, 'not-a-certificate'] },
        400,
      );
      expect(errorCode(response)).toBe('IDENTITY_PROVIDER_CERTIFICATE_INVALID');
      expect((response.body as { error: { details: unknown } }).error.details).toEqual({
        position: 2,
      });
    });

    it('建立：issuer 存 IdP 的 entity ID、沒有 client；列表帶 SP 的 entity ID、ACS 與憑證摘要', async () => {
      const created = dataOf<{
        id: string;
        protocol: string;
        issuer: string;
        clientId: string | null;
        saml: { spEntityId: string; certificates: Array<{ fingerprint: string; pem: string }> };
      }>(await createSamlProvider());
      providerId = created.id;
      spEntityId = created.saml.spEntityId;
      expect(created).toMatchObject({ protocol: 'saml', issuer: samlIdp.entityId, clientId: null });
      expect(spEntityId).toMatch(
        /^http:\/\/localhost:5175\/api\/oidc-interaction\/external\/saml\/metadata\/[0-9a-f-]+\/[0-9a-f-]+$/,
      );
      expect(spEntityId.endsWith(`/${providerId}`)).toBe(true);
      expect(created.saml.certificates[0]!.fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);

      const list = dataOf<{ samlAcsUrl: string }>(
        await request(http)
          .get('/identity-providers')
          .set('authorization', `Bearer ${await superAdminToken()}`)
          .expect(200),
      );
      expect(list.samlAcsUrl).toBe(`${PLATFORM_ORIGIN}/api/oidc-interaction/external/saml/acs`);
    });

    it('SP metadata：公開、網址就是 entity ID；不存在的連線 → 404', async () => {
      const path = internalPath(spEntityId);
      const metadata = await idp('get', path).expect(200);
      expect(metadata.headers['content-type']).toContain('application/samlmetadata+xml');
      expect(metadata.text).toContain(`entityID="${spEntityId}"`);
      expect(metadata.text).toContain('WantAssertionsSigned="true"');

      const missing = path.replace(providerId, '00000000-0000-4000-8000-000000000000');
      await idp('get', missing).expect(404);
    });

    it('不能換協定：以 OIDC 更新 SAML 連線 → IDENTITY_PROVIDER_PROTOCOL_MISMATCH', async () => {
      const response = await request(http)
        .patch(`/identity-providers/${providerId}`)
        .set('authorization', `Bearer ${await superAdminToken()}`)
        .send({ protocol: 'oidc', name: 'x' })
        .expect(400);
      expect(errorCode(response)).toBe('IDENTITY_PROVIDER_PROTOCOL_MISMATCH');
    });

    it('完整的登入：AuthnRequest → 簽章的回應 POST 到 ACS → 自動建立帳號並連結 → 產品的 session', async () => {
      const interaction = await startInteraction();
      const { requestId, relayState } = await startSaml(interaction);
      // 綁定 cookie：跨站 POST 要帶得上，只能是 SameSite=None（一定要 Secure），只送到 ACS
      const attributes = interaction.jar.attributesOf('ext_login_') ?? '';
      expect(attributes).toMatch(/SameSite=None/i);
      expect(attributes).toMatch(/Secure/i);
      expect(attributes).toContain('Path=/api/oidc-interaction/external/saml/acs');

      const email = `new-person@${SAML_DOMAIN}`;
      const samlResponse = responseFor(requestId, email);
      const location = await postAcs(samlResponse, relayState, interaction.jar.header());
      const accessToken = await completeLogin(interaction, location);
      expect(await profileEmail(accessToken)).toBe(email);

      const [identity] = await db
        .select()
        .from(userIdentities)
        .where(eq(userIdentities.subject, `nameid-${email}`));
      expect(identity?.providerId).toBe(providerId);

      // 同一份回應再送一次（重放）：RelayState 的登入狀態已用掉
      const replay = await postAcs(samlResponse, relayState, interaction.jar.header());
      expect(replay).toContain('/error?error=AUTH_SSO_EXTERNAL_FAILED');
    });

    it('別的瀏覽器（沒有綁定 cookie）把回應送到 ACS → 拒絕，不驗證回應', async () => {
      const interaction = await startInteraction();
      const { requestId, relayState } = await startSaml(interaction);
      const location = await postAcs(
        responseFor(requestId, `someone@${SAML_DOMAIN}`),
        relayState,
        '',
      );
      expect(location).toContain(`/interaction/${interaction.uid}?error=AUTH_SSO_EXTERNAL_FAILED`);
    });

    it.each([
      ['簽章後竄改 email', { tamperEmail: `victim@${SAML_DOMAIN}` }],
      ['回應的 InResponseTo 是別的 request', { inResponseTo: '_someone-elses-request' }],
      ['Audience 是別的 SP', { audience: 'https://other-sp.test' }],
    ])('%s → 拒絕並寫失敗稽核', async (_label, overrides) => {
      const interaction = await startInteraction();
      const { requestId, relayState } = await startSaml(interaction);
      const location = await postAcs(
        responseFor(requestId, `attacker@${SAML_DOMAIN}`, overrides),
        relayState,
        interaction.jar.header(),
      );
      expect(location).toContain(`/interaction/${interaction.uid}?error=AUTH_SSO_EXTERNAL_FAILED`);
    });

    it('換 IdP 的 entity ID → 已連結的身分全部作廢（新的 IdP 的 NameID 不代表同一個人）', async () => {
      const before = await db
        .select()
        .from(userIdentities)
        .where(eq(userIdentities.providerId, providerId));
      expect(before.length).toBeGreaterThan(0);
      await request(http)
        .patch(`/identity-providers/${providerId}`)
        .set('authorization', `Bearer ${await superAdminToken()}`)
        .send({ protocol: 'saml', entityId: 'https://another-idp.test/metadata' })
        .expect(200);
      const after = await db
        .select()
        .from(userIdentities)
        .where(eq(userIdentities.providerId, providerId));
      expect(after).toHaveLength(0);
      await request(http)
        .patch(`/identity-providers/${providerId}`)
        .set('authorization', `Bearer ${await superAdminToken()}`)
        .send({ protocol: 'saml', entityId: samlIdp.entityId })
        .expect(200);
    });
  });

  // ── 帳號的外部身分 ─────────────────────────────────────────

  describe('帳號的外部身分：檢視與解除（§3.3.4）', () => {
    let providerId = '';

    beforeAll(async () => {
      const [row] = await db
        .insert(identityProviders)
        .values({
          name: 'Identity List IdP',
          issuer: 'https://identity-list.test',
          clientId: 'c',
          clientSecretEncrypted: 'x',
        })
        .returning({ id: identityProviders.id });
      providerId = row!.id;
    });

    async function linked(email: string, roleSlug?: string) {
      const userId = await createUser(email);
      if (roleSlug) {
        const [role] = await db.select().from(roles).where(eq(roles.slug, roleSlug));
        await db.insert(relationTuples).values(roleHolderTuple(role!.id, userId));
      }
      const [identity] = await db
        .insert(userIdentities)
        .values({ userId, providerId, subject: `sub-${email}`, email })
        .returning({ id: userIdentities.id });
      return { userId, identityId: identity!.id };
    }

    it('列出連結（含連線名稱與協定）；解除後寫稽核、之後找不到', async () => {
      const { userId, identityId } = await linked('linked-member@example.com');
      const admin = await superAdminToken();
      const list = dataOf<{ items: Array<Record<string, unknown>> }>(
        await request(http)
          .get(`/users/${userId}/identities`)
          .set('authorization', `Bearer ${admin}`)
          .expect(200),
      );
      expect(list.items).toEqual([
        expect.objectContaining({
          id: identityId,
          providerName: 'Identity List IdP',
          protocol: 'oidc',
          providerDeleted: false,
          subject: 'sub-linked-member@example.com',
        }),
      ]);

      await request(http)
        .delete(`/users/${userId}/identities/${identityId}`)
        .set('authorization', `Bearer ${admin}`)
        .expect(204);
      const [audit] = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'userIdentity.unlink'));
      expect(audit?.resourceId).toBe(userId);
      const again = await request(http)
        .delete(`/users/${userId}/identities/${identityId}`)
        .set('authorization', `Bearer ${admin}`)
        .expect(404);
      expect(errorCode(again)).toBe('USER_IDENTITY_NOT_FOUND');
    });

    it('目標是 super-admin、操作者不是 → AUTHZ_ESCALATION', async () => {
      const target = await linked('linked-root@example.com', 'super-admin');
      const adminUser = await createUser('identity-admin@example.com');
      const [adminRole] = await db.select().from(roles).where(eq(roles.slug, 'admin'));
      await db.insert(relationTuples).values(roleHolderTuple(adminRole!.id, adminUser));
      const adminToken = await tokenOf({ email: 'identity-admin@example.com', password: PASSWORD });

      const response = await request(http)
        .delete(`/users/${target.userId}/identities/${target.identityId}`)
        .set('authorization', `Bearer ${adminToken}`)
        .expect(403);
      expect(errorCode(response)).toBe('AUTHZ_ESCALATION');
    });
  });

  // ── 通行金鑰 ────────────────────────────────────────────

  describe('通行金鑰取代密碼（§3.6）', () => {
    const authenticator = new SoftAuthenticator(PLATFORM_ORIGIN);
    const EMAIL = 'passkey-login@example.com';

    async function configureWebAuthn(passkeyLogin: 'enabled' | 'disabled') {
      const token = await platformToken();
      const current = dataOf<{ version: number | null }>(
        await platform('get', '/platform/mfa-methods/webauthn/settings', token).expect(200),
      );
      await platform('put', '/platform/mfa-methods/webauthn/settings', token)
        .send({
          values: {
            rpName: 'B2B Test',
            userVerification: 'preferred',
            authenticatorAttachment: 'any',
            passkeyLogin,
          },
          secrets: {},
          version: current.version,
        })
        .expect(200);
      await platform('put', '/platform/mfa-methods/webauthn', token)
        .send({ state: 'on' })
        .expect(200);
    }

    async function details(interaction: Interaction) {
      return dataOf<{ passkeyLogin: boolean }>(
        await idp('get', `/oidc-interaction/${interaction.uid}/details`)
          .set('cookie', interaction.jar.header())
          .expect(200),
      );
    }

    async function passkeyAssertion(interaction: Interaction, override = {}) {
      const options = dataOf<{
        publicData: { options: { challenge: string; rpId: string; allowCredentials?: unknown[] } };
      }>(await interactionPost(interaction, '/passkey/options').expect(200));
      expect(options.publicData.options.allowCredentials ?? []).toEqual([]);
      return authenticator.authenticate(options.publicData.options, 'localhost', override);
    }

    afterEach(async () => {
      await app.get(MfaMethodOverrideService).reload();
      await app.get(MfaMethodSettingsService).reload();
    });

    beforeAll(async () => {
      // 以「重新登入並新增」（docs/architecture/backend/21-mfa.md §7.1）註冊一把通行金鑰
      await configureWebAuthn('disabled');
      await app.get(MfaMethodOverrideService).reload();
      await app.get(MfaMethodSettingsService).reload();
      await createUser(EMAIL);
      const interaction = await startInteraction(BACKSTAGE, {
        prompt: 'login',
        mfa_enroll: 'webauthn',
      });
      await interactionPost(interaction, '/login', { email: EMAIL, password: PASSWORD }).expect(
        200,
      );
      const started = dataOf<{
        factorId: string;
        challenge: { challengeId: string; publicData: { options: never } };
      }>(await interactionPost(interaction, '/mfa/enroll', { method: 'webauthn' }).expect(200));
      const response = authenticator.register(started.challenge.publicData.options);
      await interactionPost(interaction, `/mfa/enroll/${started.factorId}/confirm`, {
        challengeId: started.challenge.challengeId,
        payload: { response },
        label: 'Soft key',
      }).expect(200);
    });

    it('平台參數沒開 → 互動頁不顯示、端點回 AUTH_PASSKEY_UNAVAILABLE', async () => {
      const interaction = await startInteraction();
      expect((await details(interaction)).passkeyLogin).toBe(false);
      const response = await interactionPost(interaction, '/passkey/options').expect(400);
      expect(errorCode(response)).toBe('AUTH_PASSKEY_UNAVAILABLE');
    });

    it('開啟之後：不輸入密碼、不經第二步，以通行金鑰登入產品', async () => {
      await configureWebAuthn('enabled');
      const interaction = await startInteraction();
      expect((await details(interaction)).passkeyLogin).toBe(true);
      const assertion = await passkeyAssertion(interaction);
      const login = await interactionPost(interaction, '/passkey/login', {
        payload: { response: assertion },
      }).expect(200);
      const accessToken = await finish(
        interaction,
        dataOf<{ redirectTo: string }>(login).redirectTo,
      );
      expect(await profileEmail(accessToken)).toBe(EMAIL);
    });

    it('同一個 challenge 不能用兩次；user handle 不符 → AUTH_PASSKEY_INVALID', async () => {
      await configureWebAuthn('enabled');
      const interaction = await startInteraction();
      const assertion = await passkeyAssertion(interaction);
      await interactionPost(interaction, '/passkey/login', {
        payload: { response: assertion },
      }).expect(200);

      const second = await startInteraction();
      const reused = await interactionPost(second, '/passkey/login', {
        payload: { response: assertion },
      }).expect(400);
      expect(errorCode(reused)).toBe('AUTH_PASSKEY_INVALID');

      const forged = await passkeyAssertion(second, {
        userHandle: Buffer.from('someone-else').toString('base64url'),
      });
      const response = await interactionPost(second, '/passkey/login', {
        payload: { response: forged },
      }).expect(400);
      expect(errorCode(response)).toBe('AUTH_PASSKEY_INVALID');
    });

    it('產品要求新增驗證方式的登入 → 不接受通行金鑰（要先以密碼重新驗證）', async () => {
      await configureWebAuthn('enabled');
      const interaction = await startInteraction(BACKSTAGE, {
        prompt: 'login',
        mfa_enroll: 'webauthn',
      });
      expect((await details(interaction)).passkeyLogin).toBe(false);
      const response = await interactionPost(interaction, '/passkey/options').expect(400);
      expect(errorCode(response)).toBe('AUTH_PASSKEY_UNAVAILABLE');
    });
  });
});
