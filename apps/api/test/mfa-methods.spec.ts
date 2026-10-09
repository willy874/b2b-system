import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ObjectStorage } from '@/core/storage';
import {
  mfaChannelLinks,
  mfaMethodOverrides,
  mfaMethodSettings,
  platformAdmins,
  tenants,
} from '@/db/platform/schema';
import { mfaFactors, users } from '@/db/schema';
import { upsertPlatformAdmin } from '@/db/seeds/platform-admin';
import { TelegramChannel } from '@/modules/mfa-messaging/telegram.channel';
import { MfaMethodOverrideService } from '@/modules/mfa/mfa-method-override.service';
import { MfaMethodSettingsService } from '@/modules/mfa/mfa-method-settings.service';

import {
  messages,
  MOCK_LINE_SECRET,
  MOCK_LINE_TOKEN,
  MOCK_TELEGRAM_BOT,
  MOCK_TELEGRAM_TOKEN,
  MOCK_TWILIO_SID,
  MOCK_TWILIO_TOKEN,
  startMockMessaging,
} from '../scripts/mock-messaging';
import type { PlatformTestDatabase, TestDatabase } from './db';
import { createPlatformTestDatabase, createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { InMemoryObjectStorage } from './in-memory-object-storage';

/**
 * 新的驗證方式（docs/architecture/backend/21-mfa.md §5.1、§7.1、§9.3–§9.5）：平台參數與開啟的前置條件、簡訊、
 * 通訊軟體的綁定與 webhook、WebAuthn 的「重新登入並新增」。供應商是 `scripts/mock-messaging.ts`（起在隨機埠）。
 */

let app: INestApplication;
let http: App;
let db: TestDatabase;
let platformDb: PlatformTestDatabase;
let mock: { url: string; server: Server };
const closers: Array<() => Promise<void>> = [];

const PASSWORD = 'Mfa-Methods!Pass2026';
const SUPER_ADMIN = { email: 'mfa-methods-root@example.com', password: 'Quiet-Harbor-Lantern-26' };
const PLATFORM_ADMIN = {
  email: 'mfa-methods-platform@example.com',
  password: 'PlatformPassword!2026',
};
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

function errorDetails(response: request.Response): Record<string, unknown> | undefined {
  return (response.body as { error?: { details?: Record<string, unknown> } }).error?.details;
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

function authorizeQuery(client: Client, extra: Record<string, string> = {}) {
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
  return { query, verifier };
}

async function startInteraction(
  client: Client = BACKSTAGE,
  extra: Record<string, string> = {},
): Promise<Interaction> {
  const jar = new CookieJar();
  const { query, verifier } = authorizeQuery(client, extra);
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

async function userToken(email: string): Promise<string> {
  const response = await request(http)
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  return dataOf<{ accessToken: string }>(response).accessToken;
}

/** 平台管理者的 token（測試環境不要求平台管理者的 MFA）。 */
async function platformToken(): Promise<string> {
  const interaction = await startInteraction(AUTH_APP);
  const login = await interactionPost(interaction, '/login', PLATFORM_ADMIN).expect(200);
  return finish(interaction, dataOf<{ redirectTo: string }>(login).redirectTo);
}

function platform(
  method: 'get' | 'put' | 'patch' | 'delete',
  path: string,
  token: string,
): request.Test {
  return request(http)[method](path).set('Host', AUTH_HOST).set('authorization', `Bearer ${token}`);
}

/** 模擬的供應商收到、送給 `to` 的第 `count` 則驗證碼（背景工作送出，要等）。 */
function waitForCode(to: string, count = 1): Promise<string> {
  return vi.waitFor(
    () => {
      const codes = messages
        .filter((message) => message.to === to && message.code)
        .map((message) => message.code!)
        .reverse();
      expect(codes.length).toBeGreaterThanOrEqual(count);
      return codes[count - 1]!;
    },
    { timeout: 20_000, interval: 200 },
  );
}

const SMS_SETTINGS = {
  values: {
    provider: 'twilio',
    twilioAccountSid: MOCK_TWILIO_SID,
    twilioFrom: '+15005550006',
    allowedCountryCodes: '886',
  },
  secrets: { twilioAuthToken: MOCK_TWILIO_TOKEN },
};

async function configure(
  token: string,
  method: string,
  body: { values: object; secrets: object },
  status = 200,
): Promise<request.Response> {
  const current = dataOf<{ version: number | null }>(
    await platform('get', `/platform/mfa-methods/${method}/settings`, token).expect(200),
  );
  return platform('put', `/platform/mfa-methods/${method}/settings`, token)
    .send({ ...body, version: current.version })
    .expect(status);
}

async function enable(token: string, method: string): Promise<void> {
  await platform('put', `/platform/mfa-methods/${method}`, token).send({ state: 'on' }).expect(200);
}

describe('MFA 的新方式（docs/architecture/backend/21-mfa.md §5.1、§7.1、§9.3–§9.5）', () => {
  beforeAll(async () => {
    mock = await startMockMessaging(0);
    closers.push(() => new Promise((resolve) => mock.server.close(() => resolve())));
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN.email;
    process.env.SUPER_ADMIN_PASSWORD = SUPER_ADMIN.password;
    process.env.AUTH_RATE_LIMIT = '1000';
    process.env.JOBS_WORKER_ENABLED = 'true';
    process.env.AUDIT_LOG_ARCHIVE_CRON = '';
    process.env.FILE_MAINTENANCE_CRON = '';
    process.env.MFA_TWILIO_API_URL = mock.url;
    process.env.MFA_TELEGRAM_API_URL = mock.url;
    process.env.MFA_LINE_API_URL = mock.url;

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
    await platformDb.delete(mfaChannelLinks);

    const { AppModule } = await import('@/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ObjectStorage)
      .useValue(new InMemoryObjectStorage())
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.use(cookieParser());
    const { registerMfaChannelBodyParser } =
      await import('@/modules/mfa-messaging/messaging-webhook.http');
    registerMfaChannelBodyParser(app);
    await app.init();
    http = await listenOnLoopback(app);
  });

  afterEach(async () => {
    await platformDb.delete(mfaMethodOverrides);
    await platformDb.delete(mfaMethodSettings);
    await platformDb.update(tenants).set({ mfaMethods: {} });
    await app.get(MfaMethodOverrideService).reload();
    await app.get(MfaMethodSettingsService).reload();
  });

  afterAll(async () => {
    await app.close();
    for (const close of closers) await close();
    for (const key of [
      'AUTH_RATE_LIMIT',
      'JOBS_WORKER_ENABLED',
      'AUDIT_LOG_ARCHIVE_CRON',
      'FILE_MAINTENANCE_CRON',
      'MFA_TWILIO_API_URL',
      'MFA_TELEGRAM_API_URL',
      'MFA_LINE_API_URL',
    ]) {
      delete process.env[key];
    }
  });

  describe('平台參數：填齊之前不能開啟（§5.1）', () => {
    it('沒有參數：全平台與租戶層都不能開啟；列表標示未設定', async () => {
      const token = await platformToken();
      const list = dataOf<{
        items: Array<{ id: string; settings: { configured: boolean } | null }>;
      }>(await platform('get', '/platform/mfa-methods', token).expect(200));
      expect(list.items.find((item) => item.id === 'sms')?.settings?.configured).toBe(false);
      expect(list.items.find((item) => item.id === 'totp')?.settings).toBeNull();

      const global = await platform('put', '/platform/mfa-methods/sms', token)
        .send({ state: 'on' })
        .expect(409);
      expect(errorCode(global)).toBe('MFA_METHOD_NOT_CONFIGURED');

      const [tenant] = await platformDb.select().from(tenants).where(eq(tenants.code, 'test'));
      const forTenant = await platform('patch', `/platform/tenants/${tenant!.id}`, token)
        .send({ mfaMethods: { sms: true } })
        .expect(409);
      expect(errorCode(forTenant)).toBe('MFA_METHOD_NOT_CONFIGURED');
      expect(errorDetails(forTenant)).toEqual({ methods: ['sms'] });
    });

    it('供應商拒絕金鑰 → MFA_METHOD_SETTINGS_CHECK_FAILED，不儲存', async () => {
      const token = await platformToken();
      const response = await configure(
        token,
        'sms',
        {
          values: SMS_SETTINGS.values,
          secrets: { twilioAuthToken: 'wrong-token' },
        },
        400,
      );
      expect(errorCode(response)).toBe('MFA_METHOD_SETTINGS_CHECK_FAILED');
      expect(errorDetails(response)).toEqual({
        fields: { twilioAuthToken: 'MFA_SETTING_REJECTED' },
      });
      expect(await platformDb.select().from(mfaMethodSettings)).toHaveLength(0);
    });

    it('必填欄位沒填 → VALIDATION_FAILED（依供應商決定哪些必填）', async () => {
      const token = await platformToken();
      const response = await configure(
        token,
        'sms',
        {
          values: { provider: 'twilio', allowedCountryCodes: '886' },
          secrets: {},
        },
        400,
      );
      expect(errorCode(response)).toBe('VALIDATION_FAILED');
      expect(errorDetails(response)).toEqual({
        fields: {
          twilioAccountSid: 'MFA_SETTING_REQUIRED',
          twilioAuthToken: 'MFA_SETTING_REQUIRED',
          twilioFrom: 'MFA_SETTING_REQUIRED',
        },
      });
    });

    it('檢查通過才儲存：機密加密存放、API 不回傳；之後才能開啟；開著時不能刪除參數', async () => {
      const token = await platformToken();
      const saved = dataOf<{
        configured: boolean;
        values: object;
        secrets: object;
        version: number;
      }>(await configure(token, 'sms', SMS_SETTINGS));
      expect(saved).toMatchObject({
        configured: true,
        values: SMS_SETTINGS.values,
        secrets: { twilioAuthToken: true, webhookSecret: false },
        version: 1,
      });
      const [row] = await platformDb.select().from(mfaMethodSettings);
      expect(row!.secretsEncrypted).not.toContain(MOCK_TWILIO_TOKEN);
      expect(JSON.stringify(row!.values)).not.toContain(MOCK_TWILIO_TOKEN);

      await enable(token, 'sms');
      const inUse = await platform('delete', '/platform/mfa-methods/sms/settings', token).expect(
        409,
      );
      expect(errorCode(inUse)).toBe('MFA_METHOD_SETTINGS_IN_USE');

      // 舊的版本 → 樂觀鎖
      const stale = await platform('put', '/platform/mfa-methods/sms/settings', token)
        .send({ ...SMS_SETTINGS, version: null })
        .expect(409);
      expect(errorCode(stale)).toBe('MFA_METHOD_SETTINGS_VERSION_CONFLICT');

      await platform('put', '/platform/mfa-methods/sms', token)
        .send({ state: 'default' })
        .expect(200);
      await platform('delete', '/platform/mfa-methods/sms/settings', token).expect(200);
      expect(await platformDb.select().from(mfaMethodSettings)).toHaveLength(0);
    });
  });

  describe('簡訊驗證碼（§9.4）', () => {
    it('國碼不在允許清單 → VALIDATION_FAILED；設定 → 收到簡訊確認；登入以簡訊通過第二步', async () => {
      const token = await platformToken();
      await configure(token, 'sms', SMS_SETTINGS);
      await enable(token, 'sms');

      const userId = await createUser('sms-user@example.com');
      const access = await userToken('sms-user@example.com');
      const notAllowed = await request(http)
        .post('/auth/mfa/factors')
        .set('authorization', `Bearer ${access}`)
        .send({ method: 'sms', input: { phone: '+15005550006' } })
        .expect(400);
      expect(errorDetails(notAllowed)).toMatchObject({
        fields: { 'input.phone': 'MFA_PHONE_COUNTRY_NOT_ALLOWED' },
      });

      const started = dataOf<{
        factorId: string;
        publicData: { phone: string };
        challenge: { challengeId: string };
      }>(
        await request(http)
          .post('/auth/mfa/factors')
          .set('authorization', `Bearer ${access}`)
          .send({ method: 'sms', input: { phone: '+886 912-345-678' } })
          .expect(200),
      );
      expect(started.publicData.phone).toBe('+8869*****678');
      const code = await waitForCode('+886912345678');
      await request(http)
        .post(`/auth/mfa/factors/${started.factorId}/confirm`)
        .set('authorization', `Bearer ${access}`)
        .send({ challengeId: started.challenge.challengeId, payload: { code } })
        .expect(200);
      const [factor] = await db.select().from(mfaFactors).where(eq(mfaFactors.userId, userId));
      expect(factor).toMatchObject({ method: 'sms', status: 'active' });
      expect(factor!.secretEncrypted).not.toContain('912345678');

      const interaction = await startInteraction();
      const next = dataOf<{
        next: string;
        factors: Array<{ id: string; method: string; hint: string }>;
      }>(
        await interactionPost(interaction, '/login', {
          email: 'sms-user@example.com',
          password: PASSWORD,
        }).expect(200),
      );
      expect(next.next).toBe('mfa');
      expect(next.factors[0]).toMatchObject({ method: 'sms', hint: '+8869*****678' });
      const challenge = dataOf<{ challengeId: string }>(
        await interactionPost(interaction, '/mfa/challenge', {
          factorId: next.factors[0]!.id,
        }).expect(200),
      );
      const loginCode = await waitForCode('+886912345678', 2);
      const verified = await interactionPost(interaction, '/mfa/verify', {
        factorId: next.factors[0]!.id,
        challengeId: challenge.challengeId,
        payload: { code: loginCode },
      }).expect(200);
      expect(
        await finish(interaction, dataOf<{ redirectTo: string }>(verified).redirectTo),
      ).toBeTruthy();
    });
  });

  describe('通訊軟體（§9.5）', () => {
    it('Telegram：儲存參數時取得 Bot、登記 webhook；綁定前請求驗證碼 → 409；webhook 綁定後完成設定', async () => {
      const token = await platformToken();
      const saved = dataOf<{ values: { botUsername: string } }>(
        await configure(token, 'telegram', {
          values: {},
          secrets: { botToken: MOCK_TELEGRAM_TOKEN },
        }),
      );
      expect(saved.values.botUsername).toBe(MOCK_TELEGRAM_BOT);
      await enable(token, 'telegram');

      const userId = await createUser('telegram-user@example.com');
      const access = await userToken('telegram-user@example.com');
      const started = dataOf<{
        factorId: string;
        challenge: null;
        publicData: { code: string; linkUrl: string };
      }>(
        await request(http)
          .post('/auth/mfa/factors')
          .set('authorization', `Bearer ${access}`)
          .send({ method: 'telegram' })
          .expect(200),
      );
      expect(started.challenge).toBeNull();
      const linkCode = started.publicData.code.replace('/start ', '');
      expect(started.publicData.linkUrl).toBe(
        `https://t.me/${MOCK_TELEGRAM_BOT}?start=${linkCode}`,
      );

      const notLinked = await request(http)
        .post(`/auth/mfa/factors/${started.factorId}/challenge`)
        .set('authorization', `Bearer ${access}`)
        .expect(409);
      expect(errorCode(notLinked)).toBe('MFA_CHANNEL_NOT_LINKED');

      const update = {
        message: {
          text: `/start ${linkCode}`,
          chat: { id: 777, type: 'private' },
          from: { username: 'alice' },
        },
      };
      // 簽章（secret token）不對：不處理
      await request(http)
        .post('/mfa-channels/telegram/webhook')
        .set('x-telegram-bot-api-secret-token', 'forged')
        .send(update)
        .expect(401);
      await request(http)
        .post('/mfa-channels/telegram/webhook')
        .set(
          'x-telegram-bot-api-secret-token',
          TelegramChannel.webhookSecretOf(MOCK_TELEGRAM_TOKEN),
        )
        .send(update)
        .expect(200);
      expect(
        messages.some((message) => message.to === '777' && message.text.includes('已完成綁定')),
      ).toBe(true);

      const challenge = dataOf<{ challengeId: string; hint: string }>(
        await request(http)
          .post(`/auth/mfa/factors/${started.factorId}/challenge`)
          .set('authorization', `Bearer ${access}`)
          .expect(200),
      );
      expect(challenge.hint).toBe('@alice');
      const code = await waitForCode('777');
      await request(http)
        .post(`/auth/mfa/factors/${started.factorId}/confirm`)
        .set('authorization', `Bearer ${access}`)
        .send({ challengeId: challenge.challengeId, payload: { code } })
        .expect(200);
      const [factor] = await db.select().from(mfaFactors).where(eq(mfaFactors.userId, userId));
      expect(factor).toMatchObject({
        method: 'telegram',
        status: 'active',
        config: expect.objectContaining({ recipientName: '@alice' }),
      });
      expect(factor!.secretEncrypted).not.toBe('777');

      // 同一個綁定碼不能再綁一次
      const [link] = await platformDb
        .select()
        .from(mfaChannelLinks)
        .where(eq(mfaChannelLinks.accountId, userId));
      expect(link!.linkedAt).not.toBeNull();
    });

    it('LINE：簽章不對 → 401；正確簽章的綁定碼訊息完成綁定', async () => {
      const token = await platformToken();
      const saved = dataOf<{ values: { botBasicId: string } }>(
        await configure(token, 'line', {
          values: {},
          secrets: { channelAccessToken: MOCK_LINE_TOKEN, channelSecret: MOCK_LINE_SECRET },
        }),
      );
      expect(saved.values.botBasicId).toBe('@mockbot');
      await enable(token, 'line');

      const userId = await createUser('line-user@example.com');
      const access = await userToken('line-user@example.com');
      const started = dataOf<{
        factorId: string;
        publicData: { code: string; addFriendUrl: string };
      }>(
        await request(http)
          .post('/auth/mfa/factors')
          .set('authorization', `Bearer ${access}`)
          .send({ method: 'line' })
          .expect(200),
      );
      expect(started.publicData.addFriendUrl).toBe('https://line.me/R/ti/p/%40mockbot');

      const body = JSON.stringify({
        events: [
          {
            type: 'message',
            replyToken: 'reply-1',
            source: { type: 'user', userId: 'U-line-1' },
            message: { type: 'text', text: `綁定 ${started.publicData.code.toLowerCase()}` },
          },
        ],
      });
      await request(http)
        .post('/mfa-channels/line/webhook')
        .set('content-type', 'application/json')
        .set('x-line-signature', 'forged')
        .send(body)
        .expect(401);
      await request(http)
        .post('/mfa-channels/line/webhook')
        .set('content-type', 'application/json')
        .set(
          'x-line-signature',
          createHmac('sha256', MOCK_LINE_SECRET).update(body).digest('base64'),
        )
        .send(body)
        .expect(200);
      const [link] = await platformDb
        .select()
        .from(mfaChannelLinks)
        .where(eq(mfaChannelLinks.accountId, userId));
      expect(link).toMatchObject({ channel: 'line', recipientName: 'Mock LINE User' });
      expect(link!.recipientEncrypted).not.toBe('U-line-1');

      const challenge = dataOf<{ challengeId: string }>(
        await request(http)
          .post(`/auth/mfa/factors/${started.factorId}/challenge`)
          .set('authorization', `Bearer ${access}`)
          .expect(200),
      );
      const code = await waitForCode('U-line-1');
      await request(http)
        .post(`/auth/mfa/factors/${started.factorId}/confirm`)
        .set('authorization', `Bearer ${access}`)
        .send({ challengeId: challenge.challengeId, payload: { code } })
        .expect(200);
    });
  });

  describe('WebAuthn 與「重新登入並新增」（§7.1、§9.3）', () => {
    it('mfa_enroll 沒有 prompt=login、或不是只能在 apps/platform 設定的方式 → 授權被拒', async () => {
      const cases: Array<Record<string, string>> = [
        { mfa_enroll: 'webauthn' },
        { mfa_enroll: 'totp', prompt: 'login' },
      ];
      for (const extra of cases) {
        const { query } = authorizeQuery(BACKSTAGE, extra);
        // oxlint-disable-next-line no-await-in-loop -- 依序檢查兩種錯誤
        const response = await idp('get', `/oidc/auth?${query.toString()}`);
        expect(response.headers.location).toContain('error=invalid_request');
      }
    });

    it('沒有因子的人：密碼通過後直接進入可略過的設定；註冊的 options 綁 apps/platform 的網域；略過照常登入', async () => {
      const token = await platformToken();
      await configure(token, 'webauthn', {
        values: {
          rpName: 'B2B Test',
          userVerification: 'preferred',
          authenticatorAttachment: 'any',
        },
        secrets: {},
      });
      await enable(token, 'webauthn');
      await createUser('passkey-user@example.com');

      const interaction = await startInteraction(BACKSTAGE, {
        prompt: 'login',
        mfa_enroll: 'webauthn',
      });
      const details = dataOf<{ mfaEnroll: string | null }>(
        await idp('get', `/oidc-interaction/${interaction.uid}/details`)
          .set('cookie', interaction.jar.header())
          .expect(200),
      );
      expect(details.mfaEnroll).toBe('webauthn');

      const next = dataOf<{ next: string; optional: boolean; methods: Array<{ id: string }> }>(
        await interactionPost(interaction, '/login', {
          email: 'passkey-user@example.com',
          password: PASSWORD,
        }).expect(200),
      );
      expect(next).toMatchObject({
        next: 'mfaEnroll',
        optional: true,
        methods: [{ id: 'webauthn' }],
      });

      // 只能設定要求的那一種
      const other = await interactionPost(interaction, '/mfa/enroll', { method: 'totp' }).expect(
        409,
      );
      expect(errorCode(other)).toBe('MFA_METHOD_DISABLED');
      const started = dataOf<{
        challenge: {
          publicData: { options: { rp: { id: string; name: string }; challenge: string } };
        };
      }>(await interactionPost(interaction, '/mfa/enroll', { method: 'webauthn' }).expect(200));
      expect(started.challenge.publicData.options.rp).toEqual({
        id: 'localhost',
        name: 'B2B Test',
      });

      const skipped = await interactionPost(interaction, '/mfa/enroll/skip').expect(200);
      expect(
        await finish(interaction, dataOf<{ redirectTo: string }>(skipped).redirectTo),
      ).toBeTruthy();
    });

    it('backstage 的使用者不能在自助端點設定 WebAuthn（只能在登入互動裡）', async () => {
      const token = await platformToken();
      await configure(token, 'webauthn', {
        values: {
          rpName: 'B2B Test',
          userVerification: 'preferred',
          authenticatorAttachment: 'any',
        },
        secrets: {},
      });
      await enable(token, 'webauthn');
      await createUser('passkey-self@example.com');
      const response = await request(http)
        .post('/auth/mfa/factors')
        .set('authorization', `Bearer ${await userToken('passkey-self@example.com')}`)
        .send({ method: 'webauthn' })
        .expect(409);
      expect(errorCode(response)).toBe('MFA_METHOD_DISABLED');
    });
  });
});
