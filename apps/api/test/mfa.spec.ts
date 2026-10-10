import { createHash, randomBytes } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { and, desc, eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { base32Decode, hotp, totpCounter } from '@/core/mfa';
import { ObjectStorage } from '@/core/storage';
import {
  mfaMethodOverrides,
  oidcPayloads,
  platformAdminMfaFactors,
  platformAdmins,
} from '@/db/platform/schema';
import {
  auditLogs,
  groupMemberTuple,
  groupRoleTuple,
  groups,
  mfaFactors,
  mfaPolicy,
  mfaRecoveryCodes,
  relationTuples,
  roleHolderTuple,
  roles,
  users,
} from '@/db/schema';
import { upsertPlatformAdmin } from '@/db/seeds/platform-admin';
import { MfaMethodOverrideService } from '@/modules/mfa/mfa-method-override.service';

import type { PlatformTestDatabase, TestDatabase } from './db';
import { createPlatformTestDatabase, createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { InMemoryObjectStorage } from './in-memory-object-storage';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let platformDb: PlatformTestDatabase;
const closers: Array<() => Promise<void>> = [];

const PASSWORD = 'Mfa-Integration!Pass26';
const SUPER_ADMIN = { email: 'mfa-root@example.com', password: 'Quiet-Harbor-Lantern-26' };
const PLATFORM_ADMIN = { email: 'mfa-platform@example.com', password: 'PlatformPassword!2026' };

const AUTH_HOST = 'localhost:5175';

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

/** 瀏覽器的 cookie jar（同 sso.spec.ts：provider 的 cookie path 有 `/api` 前綴，手動帶）。 */
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
  state: string;
  verifier: string;
}

/** `/oidc/auth` → 登入互動的 uid（沒有 IdP session 的新瀏覽器）。 */
async function startInteraction(client: Client = BACKSTAGE): Promise<Interaction> {
  const jar = new CookieJar();
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
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
  if (client.tenant) query.set('tenant', client.tenant);
  const response = await idp('get', `/oidc/auth?${query.toString()}`);
  jar.store(response);
  const location = response.headers.location as string;
  expect(location).toContain('/oidc-interaction/');
  return { jar, uid: new URL(location).pathname.split('/').pop()!, client, state, verifier };
}

function interactionPost(interaction: Interaction, path: string, body: object): request.Test {
  return idp('post', `/oidc-interaction/${interaction.uid}${path}`)
    .set('cookie', interaction.jar.header())
    .send(body);
}

/** 頂層跳轉回 provider → 授權碼 → 產品的 BFF 換 session，回傳 access token。 */
async function finish(interaction: Interaction, redirectTo: string): Promise<string> {
  const resume = await idp('get', internalPath(redirectTo)).set('cookie', interaction.jar.header());
  interaction.jar.store(resume);
  expect(resume.status).toBe(303);
  const location = resume.headers.location as string;
  const code = new URL(location).searchParams.get('code');
  if (!code) throw new Error(`沒有授權碼：${location}`);
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

/** 新增一位可登入的使用者（直接寫 DB，沒有登入紀錄）。 */
async function createUser(email: string): Promise<string> {
  const { hashPassword } = await import('@/modules/credential/password');
  const [user] = await db
    .insert(users)
    .values({
      email,
      displayName: email,
      passwordHash: await hashPassword(PASSWORD),
      status: 'active',
    })
    .returning({ id: users.id });
  return user!.id;
}

async function directToken(email: string, password = PASSWORD): Promise<string> {
  const response = await request(http).post('/auth/login').send({ email, password }).expect(200);
  return dataOf<{ accessToken: string }>(response).accessToken;
}

/** 時鐘：TOTP 同一個時間步只能用一次，每次要碼就往前推一步（Nest 的 app 在同一個程序，看到的是同一個時間）。 */
let clock = Date.parse('2026-10-07T00:00:00Z');
function tick(seconds = 30): void {
  clock += seconds * 1000;
  vi.setSystemTime(clock);
}

function codeFor(secret: string): string {
  tick();
  return hotp(base32Decode(secret), totpCounter(Date.now()));
}

/** 以自助端點設定 TOTP；回傳 seed 與備用碼。 */
async function enrollTotp(
  token: string,
  host = '127.0.0.1',
  prefix = '/auth/mfa',
): Promise<{ secret: string; factorId: string; recoveryCodes: string[] | null }> {
  const started = await request(http)
    .post(`${prefix}/factors`)
    .set('Host', host)
    .set('authorization', `Bearer ${token}`)
    .send({ method: 'totp' })
    .expect(200);
  const { factorId, publicData } = dataOf<{ factorId: string; publicData: { otpauthUri: string } }>(
    started,
  );
  const secret = new URL(publicData.otpauthUri).searchParams.get('secret')!;
  const confirmed = await request(http)
    .post(`${prefix}/factors/${factorId}/confirm`)
    .set('Host', host)
    .set('authorization', `Bearer ${token}`)
    .send({ payload: { code: codeFor(secret) }, label: 'iPhone' });
  if (confirmed.status !== 200) throw new Error(`確認失敗：${JSON.stringify(confirmed.body)}`);
  return {
    secret,
    factorId,
    recoveryCodes: dataOf<{ recoveryCodes: string[] | null }>(confirmed).recoveryCodes,
  };
}

describe('MFA（docs/architecture/backend/21-mfa.md）', () => {
  /** access token 只有 5 分鐘，而測試會把時鐘往前推：每次重新登入。 */
  const rootToken = () => directToken(SUPER_ADMIN.email, SUPER_ADMIN.password);

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(clock);
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

    const platform = createPlatformTestDatabase();
    platformDb = platform.db;
    closers.push(async () => platform.client.end());
    await platformDb.delete(platformAdmins).where(eq(platformAdmins.email, PLATFORM_ADMIN.email));
    await upsertPlatformAdmin(platformDb, { displayName: '平台管理者', ...PLATFORM_ADMIN });
    await platformDb.delete(mfaMethodOverrides);

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

  afterEach(async () => {
    await db.delete(mfaPolicy);
    await platformDb.delete(mfaMethodOverrides);
    await app.get(MfaMethodOverrideService).reload();
  });

  afterAll(async () => {
    vi.useRealTimers();
    await app.close();
    for (const close of closers) await close();
    delete process.env.AUTH_RATE_LIMIT;
  });

  describe('自助設定（§7）', () => {
    it('TOTP：錯的碼不啟用；對的碼啟用並只在第一個因子產生 10 組備用碼；users.mfa_enabled 跟著變', async () => {
      const userId = await createUser('mfa-self@example.com');
      const token = await directToken('mfa-self@example.com');
      const started = await request(http)
        .post('/auth/mfa/factors')
        .set('authorization', `Bearer ${token}`)
        .send({ method: 'totp' })
        .expect(200);
      const { factorId } = dataOf<{ factorId: string }>(started);
      const wrong = await request(http)
        .post(`/auth/mfa/factors/${factorId}/confirm`)
        .set('authorization', `Bearer ${token}`)
        .send({ payload: { code: '000000' } })
        .expect(400);
      expect(errorCode(wrong)).toBe('AUTH_MFA_INVALID_CODE');

      const first = await enrollTotp(token);
      expect(first.recoveryCodes).toHaveLength(10);
      const second = await enrollTotp(token);
      expect(second.recoveryCodes).toBeNull();

      const [user] = await db.select().from(users).where(eq(users.id, userId));
      expect(user!.mfaEnabled).toBe(true);
      const overview = dataOf<{ factors: unknown[]; recoveryCodesRemaining: number }>(
        await request(http).get('/auth/mfa').set('authorization', `Bearer ${token}`).expect(200),
      );
      expect(overview.factors).toHaveLength(2);
      expect(overview.recoveryCodesRemaining).toBe(10);
      // 機密不進稽核
      const audits = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'mfa.factor.add'), eq(auditLogs.resourceId, userId)));
      expect(audits).toHaveLength(2);
      expect(JSON.stringify(audits.map((audit) => audit.metadata))).not.toContain(first.secret);
    });

    it('移除與重新產生備用碼要再輸入密碼；全部移除時備用碼一起刪', async () => {
      const userId = await createUser('mfa-remove@example.com');
      const token = await directToken('mfa-remove@example.com');
      const { factorId } = await enrollTotp(token);
      const mismatch = await request(http)
        .delete(`/auth/mfa/factors/${factorId}`)
        .set('authorization', `Bearer ${token}`)
        .send({ password: 'wrong-password' })
        .expect(400);
      expect(errorCode(mismatch)).toBe('AUTH_PASSWORD_MISMATCH');

      const regenerated = await request(http)
        .post('/auth/mfa/recovery-codes')
        .set('authorization', `Bearer ${token}`)
        .send({ password: PASSWORD })
        .expect(200);
      expect(dataOf<{ recoveryCodes: string[] }>(regenerated).recoveryCodes).toHaveLength(10);

      await request(http)
        .delete(`/auth/mfa/factors/${factorId}`)
        .set('authorization', `Bearer ${token}`)
        .send({ password: PASSWORD })
        .expect(200);
      expect(
        await db.select().from(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId)),
      ).toEqual([]);
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      expect(user!.mfaEnabled).toBe(false);
    });
  });

  describe('登入互動的第二步（§4）', () => {
    it('密碼通過後要第二步；通過後才完成互動，amr 帶 otp；成功的稽核在第二步之後才寫', async () => {
      const userId = await createUser('mfa-login@example.com');
      const { secret, factorId } = await enrollTotp(await directToken('mfa-login@example.com'));

      const interaction = await startInteraction();
      const login = await interactionPost(interaction, '/login', {
        email: 'mfa-login@example.com',
        password: PASSWORD,
      }).expect(200);
      const next = dataOf<{
        next: string;
        factors: Array<{ id: string }>;
        recoveryAvailable: boolean;
      }>(login);
      expect(next).toMatchObject({ next: 'mfa', recoveryAvailable: true });
      expect(next.factors.map((factor) => factor.id)).toEqual([factorId]);

      // 握著 resume 網址也跳不過第二步：密碼通過時沒有寫 result.login（互動裡沒有登入結果）
      const [stored] = await platformDb
        .select()
        .from(oidcPayloads)
        .where(and(eq(oidcPayloads.type, 'Interaction'), eq(oidcPayloads.id, interaction.uid)));
      expect((stored?.payload as { result?: unknown } | undefined)?.result).toBeUndefined();

      const verified = await interactionPost(interaction, '/mfa/verify', {
        factorId,
        payload: { code: codeFor(secret) },
      }).expect(200);
      const accessToken = await finish(
        interaction,
        dataOf<{ redirectTo: string }>(verified).redirectTo,
      );
      expect(accessToken).toBeTruthy();

      // 最後一筆是這次（之前的一筆是設定前的直接登入，只有 pwd）
      const [success] = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'auth.login.success'), eq(auditLogs.resourceId, userId)))
        .orderBy(desc(auditLogs.occurredAt))
        .limit(1);
      expect(success?.metadata).toMatchObject({ amr: ['pwd', 'mfa', 'otp'], mfaMethod: 'totp' });
    });

    it('同一個碼不能用兩次（重放）', async () => {
      await createUser('mfa-replay@example.com');
      const { secret, factorId } = await enrollTotp(await directToken('mfa-replay@example.com'));
      const code = codeFor(secret);
      const first = await startInteraction();
      await interactionPost(first, '/login', {
        email: 'mfa-replay@example.com',
        password: PASSWORD,
      }).expect(200);
      await interactionPost(first, '/mfa/verify', { factorId, payload: { code } }).expect(200);

      const second = await startInteraction();
      await interactionPost(second, '/login', {
        email: 'mfa-replay@example.com',
        password: PASSWORD,
      }).expect(200);
      const replayed = await interactionPost(second, '/mfa/verify', {
        factorId,
        payload: { code },
      }).expect(400);
      expect(errorCode(replayed)).toBe('AUTH_MFA_INVALID_CODE');
    });

    it('同一個互動錯 5 次作廢；錯誤併入帳號的失敗計數（陌生來源）', async () => {
      const userId = await createUser('mfa-attempts@example.com');
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      // 直接寫入因子：這個帳號沒有成功登入過，127.0.0.1 不是已知來源
      const { MfaSecretService } = await import('@/core/mfa');
      const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
      await db.insert(mfaFactors).values({
        userId: user!.id,
        method: 'totp',
        status: 'active',
        secretEncrypted: app.get(MfaSecretService).encrypt(secret),
        config: { algorithm: 'sha1', digits: 6, period: 30 },
      });
      const interaction = await startInteraction();
      await interactionPost(interaction, '/login', {
        email: 'mfa-attempts@example.com',
        password: PASSWORD,
      }).expect(200);
      const [factor] = await db.select().from(mfaFactors).where(eq(mfaFactors.userId, userId));
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        // 漸進延遲與密碼共用計數：每次之間等過延遲（時鐘往前推）
        tick(60);
        // oxlint-disable-next-line no-await-in-loop -- 依序送出
        const failed = await interactionPost(interaction, '/mfa/verify', {
          factorId: factor!.id,
          payload: { code: '000000' },
        }).expect(400);
        expect(errorCode(failed)).toBe('AUTH_MFA_INVALID_CODE');
      }
      tick(60);
      const fifth = await interactionPost(interaction, '/mfa/verify', {
        factorId: factor!.id,
        payload: { code: '000000' },
      }).expect(400);
      expect(errorCode(fifth)).toBe('AUTH_MFA_TOO_MANY_ATTEMPTS');
      tick(60);
      const after = await interactionPost(interaction, '/mfa/verify', {
        factorId: factor!.id,
        payload: { code: codeFor(secret) },
      }).expect(400);
      expect(errorCode(after)).toBe('AUTH_MFA_PENDING_INVALID');

      const [counted] = await db.select().from(users).where(eq(users.id, userId));
      expect(counted!.failedLoginCount).toBeGreaterThanOrEqual(5);
    });

    it('備用碼只能用一次；用過之後剩 9 組', async () => {
      await createUser('mfa-recovery@example.com');
      const { recoveryCodes } = await enrollTotp(await directToken('mfa-recovery@example.com'));
      const code = recoveryCodes![0]!;
      const first = await startInteraction();
      await interactionPost(first, '/login', {
        email: 'mfa-recovery@example.com',
        password: PASSWORD,
      }).expect(200);
      const ok = await interactionPost(first, '/mfa/verify', {
        factorId: 'recovery',
        payload: { code: code.toLowerCase() },
      }).expect(200);
      await finish(first, dataOf<{ redirectTo: string }>(ok).redirectTo);

      const second = await startInteraction();
      await interactionPost(second, '/login', {
        email: 'mfa-recovery@example.com',
        password: PASSWORD,
      }).expect(200);
      const reused = await interactionPost(second, '/mfa/verify', {
        factorId: 'recovery',
        payload: { code },
      }).expect(400);
      expect(errorCode(reused)).toBe('AUTH_MFA_INVALID_CODE');
    });

    it('第二步進行中帳號的 session 被撤銷（管理員重設 MFA）：MfaPending 作廢', async () => {
      const userId = await createUser('mfa-revoked@example.com');
      const { secret, factorId } = await enrollTotp(await directToken('mfa-revoked@example.com'));
      const interaction = await startInteraction();
      await interactionPost(interaction, '/login', {
        email: 'mfa-revoked@example.com',
        password: PASSWORD,
      }).expect(200);

      await request(http)
        .post(`/users/${userId}/mfa/reset`)
        .set('authorization', `Bearer ${await rootToken()}`)
        .expect(200);
      // SESSIONS_REVOKED 是 fire-and-forget：等它把 MfaPending 刪掉
      await vi.waitFor(
        async () => {
          const response = await interactionPost(interaction, '/mfa/verify', {
            factorId,
            payload: { code: codeFor(secret) },
          });
          expect(errorCode(response)).toBe('AUTH_MFA_PENDING_INVALID');
        },
        { timeout: 5_000, interval: 100 },
      );
    });

    it('直接登入（POST /auth/login）對已設定 MFA 的帳號回 AUTH_MFA_REQUIRED', async () => {
      await createUser('mfa-direct@example.com');
      await enrollTotp(await directToken('mfa-direct@example.com'));
      const response = await request(http)
        .post('/auth/login')
        .send({ email: 'mfa-direct@example.com', password: PASSWORD })
        .expect(403);
      expect(errorCode(response)).toBe('AUTH_MFA_REQUIRED');
    });
  });

  describe('管理員檢視與重設（§8）', () => {
    it('重設：刪除因子與備用碼、token_version + 1、稽核 user.mfa.reset；不能重設自己', async () => {
      const userId = await createUser('mfa-reset@example.com');
      await enrollTotp(await directToken('mfa-reset@example.com'));
      const [before] = await db.select().from(users).where(eq(users.id, userId));
      const status = dataOf<{ enabled: boolean; factors: unknown[] }>(
        await request(http)
          .get(`/users/${userId}/mfa`)
          .set('authorization', `Bearer ${await rootToken()}`)
          .expect(200),
      );
      expect(status.enabled).toBe(true);

      await request(http)
        .post(`/users/${userId}/mfa/reset`)
        .set('authorization', `Bearer ${await rootToken()}`)
        .expect(200);
      const [after] = await db.select().from(users).where(eq(users.id, userId));
      expect(after!.mfaEnabled).toBe(false);
      expect(after!.tokenVersion).toBe(before!.tokenVersion + 1);
      expect(await db.select().from(mfaFactors).where(eq(mfaFactors.userId, userId))).toEqual([]);
      const [audit] = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'user.mfa.reset'), eq(auditLogs.resourceId, userId)));
      expect(audit?.metadata).toMatchObject({ severity: 'high' });

      const [root] = await db.select().from(users).where(eq(users.email, SUPER_ADMIN.email));
      const self = await request(http)
        .post(`/users/${root!.id}/mfa/reset`)
        .set('authorization', `Bearer ${await rootToken()}`)
        .expect(403);
      expect(errorCode(self)).toBe('AUTHZ_SELF_MODIFY');
    });

    it('重設要 user:resetMfa：只有 user:update 的人回 AUTHZ_FORBIDDEN', async () => {
      const targetId = await createUser('mfa-target@example.com');
      const editorId = await createUser('mfa-editor@example.com');
      const role = dataOf<{ id: string }>(
        await request(http)
          .post('/roles')
          .set('authorization', `Bearer ${await rootToken()}`)
          .send({ name: '只能編輯使用者', permissionKeys: ['user:update'] })
          .expect(201),
      );
      await request(http)
        .put(`/users/${editorId}/roles`)
        .set('authorization', `Bearer ${await rootToken()}`)
        .send({ roleIds: [role.id], expectedRoleIds: [] })
        .expect(200);
      const denied = await request(http)
        .post(`/users/${targetId}/mfa/reset`)
        .set('authorization', `Bearer ${await directToken('mfa-editor@example.com')}`)
        .expect(403);
      expect(errorCode(denied)).toBe('AUTHZ_FORBIDDEN');
    });

    it('反提權：admin 不能重設 super-admin 的 MFA', async () => {
      const adminId = await createUser('mfa-admin@example.com');
      const [adminRole] = await db.select().from(roles).where(eq(roles.slug, 'admin'));
      await request(http)
        .put(`/users/${adminId}/roles`)
        .set('authorization', `Bearer ${await rootToken()}`)
        .send({ roleIds: [adminRole!.id], expectedRoleIds: [] })
        .expect(200);
      const adminToken = await directToken('mfa-admin@example.com');
      const [root] = await db.select().from(users).where(eq(users.email, SUPER_ADMIN.email));
      const denied = await request(http)
        .post(`/users/${root!.id}/mfa/reset`)
        .set('authorization', `Bearer ${adminToken}`)
        .expect(403);
      expect(errorCode(denied)).toBe('AUTHZ_ESCALATION');
    });
  });

  describe('政策與開關（§5、§6）', () => {
    it('政策要求所有人：沒有因子的人在互動中先設定，確認後拿到備用碼與 resume 網址', async () => {
      await createUser('mfa-enroll@example.com');
      // 要求所有人之後 super-admin 自己也不能直接登入：先拿 token
      const root = await rootToken();
      const policy = dataOf<{ version: number }>(
        await request(http).get('/mfa/policy').set('authorization', `Bearer ${root}`).expect(200),
      );
      await request(http)
        .put('/mfa/policy')
        .set('authorization', `Bearer ${root}`)
        .send({
          requireAll: true,
          requiredRoleIds: [],
          allowedMethods: null,
          version: policy.version,
        })
        .expect(200);
      // 樂觀鎖：舊的 version 回 409
      const conflict = await request(http)
        .put('/mfa/policy')
        .set('authorization', `Bearer ${root}`)
        .send({
          requireAll: false,
          requiredRoleIds: [],
          allowedMethods: null,
          version: policy.version,
        })
        .expect(409);
      expect(errorCode(conflict)).toBe('MFA_POLICY_VERSION_CONFLICT');

      const interaction = await startInteraction();
      const login = await interactionPost(interaction, '/login', {
        email: 'mfa-enroll@example.com',
        password: PASSWORD,
      }).expect(200);
      expect(dataOf<{ next: string }>(login).next).toBe('mfaEnroll');
      const started = dataOf<{ factorId: string; publicData: { otpauthUri: string } }>(
        await interactionPost(interaction, '/mfa/enroll', { method: 'totp' }).expect(200),
      );
      const secret = new URL(started.publicData.otpauthUri).searchParams.get('secret')!;
      const confirmed = dataOf<{ recoveryCodes: string[]; redirectTo: string }>(
        await interactionPost(interaction, `/mfa/enroll/${started.factorId}/confirm`, {
          payload: { code: codeFor(secret) },
        }).expect(200),
      );
      expect(confirmed.recoveryCodes).toHaveLength(10);
      expect(await finish(interaction, confirmed.redirectTo)).toBeTruthy();
    });

    it('不符合政策的人數含經由巢狀群組持有角色的人，不含停用、待啟用與已設定的人；名單與人數一致', async () => {
      const [auditor] = await db.select().from(roles).where(eq(roles.slug, 'auditor'));
      const roleId = auditor!.id;
      const direct = await createUser('policy-direct@example.com');
      const nested = await createUser('policy-nested@example.com');
      await createUser('policy-no-role@example.com');
      const inactive = await createUser('policy-inactive@example.com');
      const pending = await createUser('policy-pending@example.com');
      await db.update(users).set({ status: 'inactive' }).where(eq(users.id, inactive));
      await db.update(users).set({ status: 'pending' }).where(eq(users.id, pending));
      const [outer] = await db.insert(groups).values({ name: 'mfa-外層' }).returning();
      const [inner] = await db.insert(groups).values({ name: 'mfa-內層' }).returning();
      await db
        .insert(relationTuples)
        .values([
          roleHolderTuple(roleId, direct),
          roleHolderTuple(roleId, inactive),
          roleHolderTuple(roleId, pending),
          groupRoleTuple(roleId, outer!.id),
          groupMemberTuple(outer!.id, { type: 'group', id: inner!.id }),
          groupMemberTuple(inner!.id, { type: 'user', id: nested }),
        ]);

      const root = await rootToken();
      const preview = dataOf<{ nonCompliant: number }>(
        await request(http)
          .post('/mfa/policy/preview')
          .set('authorization', `Bearer ${root}`)
          .send({ requireAll: false, requiredRoleIds: [roleId], allowedMethods: null, version: 1 })
          .expect(200),
      );
      expect(preview.nonCompliant).toBe(2);

      const listed = dataOf<{ items: Array<{ id: string }> }>(
        await request(http)
          .get('/users')
          .query({ mfa: 'false', status: 'active', roleId, includeGroupRoles: 'true', limit: 100 })
          .set('authorization', `Bearer ${root}`)
          .expect(200),
      );
      expect(listed.items.map((user) => user.id).toSorted()).toEqual([direct, nested].toSorted());

      // 預設只看直接持有
      const directOnly = dataOf<{ items: Array<{ id: string }> }>(
        await request(http)
          .get('/users')
          .query({ mfa: 'false', status: 'active', roleId, limit: 100 })
          .set('authorization', `Bearer ${root}`)
          .expect(200),
      );
      expect(directOnly.items.map((user) => user.id)).toEqual([direct]);

      // 選擇器補已選的人的名稱：以 id 一次取回（不逐人查詢）
      const byIds = dataOf<{ items: Array<{ id: string }> }>(
        await request(http)
          .get(`/users?id=${direct}&id=${nested}`)
          .set('authorization', `Bearer ${root}`)
          .expect(200),
      );
      expect(byIds.items.map((user) => user.id).toSorted()).toEqual([direct, nested].toSorted());
    });

    it('政策：要求啟用卻沒有可用的方式 → VALIDATION_FAILED', async () => {
      const response = await request(http)
        .put('/mfa/policy')
        .set('authorization', `Bearer ${await rootToken()}`)
        .send({ requireAll: true, requiredRoleIds: [], allowedMethods: [], version: 1 })
        .expect(400);
      expect(errorCode(response)).toBe('VALIDATION_FAILED');
    });

    it('全平台關掉 TOTP：只有 TOTP 的人有備用碼時只能用備用碼；沒有備用碼時 AUTH_MFA_UNAVAILABLE', async () => {
      const userId = await createUser('mfa-killed@example.com');
      await enrollTotp(await directToken('mfa-killed@example.com'));
      await platformDb.insert(mfaMethodOverrides).values({ method: 'totp', state: 'off' });
      await app.get(MfaMethodOverrideService).reload();

      const withRecovery = await startInteraction();
      const next = dataOf<{ next: string; factors: unknown[]; recoveryAvailable: boolean }>(
        await interactionPost(withRecovery, '/login', {
          email: 'mfa-killed@example.com',
          password: PASSWORD,
        }).expect(200),
      );
      expect(next).toMatchObject({ next: 'mfa', factors: [], recoveryAvailable: true });

      await db.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
      const without = await startInteraction();
      const unavailable = await interactionPost(without, '/login', {
        email: 'mfa-killed@example.com',
        password: PASSWORD,
      }).expect(403);
      expect(errorCode(unavailable)).toBe('AUTH_MFA_UNAVAILABLE');
    });

    it('租戶層的覆寫：全平台 off 蓋過租戶層的 on', async () => {
      await platformDb.insert(mfaMethodOverrides).values({ method: 'email', state: 'off' });
      await app.get(MfaMethodOverrideService).reload();
      const service = app.get(MfaMethodOverrideService);
      const { MfaMethodRegistry } = await import('@/core/mfa');
      const email = app.get(MfaMethodRegistry).get('email')!;
      expect(service.isEnabled(email, { email: true })).toBe(false);
      await platformDb.delete(mfaMethodOverrides);
      await service.reload();
      expect(service.isEnabled(email, { email: false })).toBe(false);
      expect(service.isEnabled(email, {})).toBe(true);
    });
  });

  describe('平台管理者（同一套流程，平台 DB）', () => {
    it('設定 TOTP 後，apps/platform 的登入要第二步', async () => {
      // 沒有 MFA 時照常登入，拿平台管理者的 token
      const first = await startInteraction(AUTH_APP);
      const login = await interactionPost(first, '/login', PLATFORM_ADMIN).expect(200);
      const token = await finish(first, dataOf<{ redirectTo: string }>(login).redirectTo);
      const { secret, factorId } = await enrollTotp(token, AUTH_HOST, '/platform/auth/mfa');
      const [admin] = await platformDb
        .select()
        .from(platformAdmins)
        .where(eq(platformAdmins.email, PLATFORM_ADMIN.email));
      expect(admin!.mfaEnabled).toBe(true);
      expect(
        await platformDb
          .select()
          .from(platformAdminMfaFactors)
          .where(eq(platformAdminMfaFactors.adminId, admin!.id)),
      ).toHaveLength(1);

      const second = await startInteraction(AUTH_APP);
      const next = await interactionPost(second, '/login', PLATFORM_ADMIN).expect(200);
      expect(dataOf<{ next: string }>(next).next).toBe('mfa');
      const verified = await interactionPost(second, '/mfa/verify', {
        factorId,
        payload: { code: codeFor(secret) },
      }).expect(200);
      expect(
        await finish(second, dataOf<{ redirectTo: string }>(verified).redirectTo),
      ).toBeTruthy();
    });
  });
});
