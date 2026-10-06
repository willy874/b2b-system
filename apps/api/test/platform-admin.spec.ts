import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Env } from '@/core/config';
import { MailTransport } from '@/core/mail';
import type { MailMessage, SentMail } from '@/core/mail';
import { ObjectStorage } from '@/core/storage';
import { TENANT_FEATURES, TenantDirectory } from '@/core/tenant';
import { platformAdmins, platformAuditLogs, tenants } from '@/db/platform/schema';
import type { PlatformAdminRole } from '@/db/platform/schema';
import { upsertPlatformAdmin } from '@/db/seeds/platform-admin';
import { PlatformAdminService } from '@/modules/platform-admin/platform-admin.service';

import type { PlatformTestDatabase, TestDatabase } from './db';
import { createPlatformTestDatabase, createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { InMemoryObjectStorage } from './in-memory-object-storage';
import { testTenantContext } from './tenant';

class RecordingMailTransport extends MailTransport {
  readonly sent: MailMessage[] = [];

  send(message: MailMessage): Promise<SentMail> {
    this.sent.push(message);
    return Promise.resolve({ messageId: `<${this.sent.length}@test>` });
  }
}

const AUTH_HOST = 'localhost:5175';
const HOME_HOST = '127.0.0.1';
const PASSWORD = 'PlatformPassword!2026';
const ROOT = { email: 'pa-root@example.com', password: 'Quiet-Harbor-Lantern-26' };
/** 新租戶預設啟用全部（db/platform/schema/tenants.ts 的預設值）。 */
const ALL_FEATURES: string[] = [...TENANT_FEATURES];

let app: INestApplication;
let http: App;
let platformDb: PlatformTestDatabase;
let home: TestDatabase;
const closers: Array<() => Promise<void>> = [];
const mailbox = new RecordingMailTransport();

interface AdminBody {
  id: string;
  email: string;
  role: PlatformAdminRole;
  status: string;
}

function dataOf<T>(response: { body: unknown }): T {
  return (response.body as { data: T }).data;
}

function errorCodeOf(response: { body: unknown }): string | undefined {
  return (response.body as { error?: { code?: string } }).error?.code;
}

async function signPlatformToken(email: string): Promise<string> {
  const [admin] = await platformDb
    .select()
    .from(platformAdmins)
    .where(eq(platformAdmins.email, email));
  if (!admin) throw new Error(`找不到平台管理者 ${email}`);
  const secret = app.get(ConfigService<Env, true>).get('JWT_SECRET', { infer: true });
  return app
    .get(JwtService)
    .signAsync(
      { sub: admin.id, ver: admin.tokenVersion, jti: randomUUID(), realm: 'platform' },
      { secret, expiresIn: 300 },
    );
}

function as(token: string, method: 'get' | 'post' | 'patch', path: string) {
  const agent = request(http);
  return agent[method](path).set('Host', AUTH_HOST).set('authorization', `Bearer ${token}`);
}

async function waitForMail(to: string, count = 1): Promise<MailMessage> {
  return vi.waitFor(
    () => {
      const messages = mailbox.sent.filter((message) => message.to === to);
      expect(messages).toHaveLength(count);
      return messages[count - 1]!;
    },
    { timeout: 20_000, interval: 200 },
  );
}

function linkToken(message: MailMessage, path: string): string {
  const match = new RegExp(`${path}\\?token=([\\w-]+)`).exec(message.text);
  if (!match) throw new Error(`信裡找不到 ${path} 的連結：\n${message.text}`);
  // 平台管理者的連結不帶租戶：apps/platform 的頁面據此走平台的端點
  expect(message.text).not.toContain('tenant=');
  return match[1]!;
}

describe('平台管理者的管理、稽核、背景工作與外部 IdP 開關（docs/architecture/05-tenancy.md §10.2 D5、D19、D22、3）', () => {
  let root: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = ROOT.email;
    process.env.SUPER_ADMIN_PASSWORD = ROOT.password;
    process.env.JOBS_WORKER_ENABLED = 'true';
    process.env.AUDIT_LOG_ARCHIVE_CRON = '';
    process.env.FILE_MAINTENANCE_CRON = '';
    process.env.AUTH_RATE_LIMIT = '1000';

    const platform = createPlatformTestDatabase();
    platformDb = platform.db;
    closers.push(async () => platform.client.end());
    for (const role of ['super-admin', 'auditor'] as const) {
      await upsertPlatformAdmin(platformDb, {
        email: `pa-${role}@example.com`,
        displayName: role,
        password: PASSWORD,
        role,
      });
    }

    const tenantDb = createTestDatabase();
    home = tenantDb.db;
    closers.push(async () => tenantDb.client.end());
    await truncateAll(home);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(home as never);

    const { AppModule } = await import('@/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailTransport)
      .useValue(mailbox)
      .overrideProvider(ObjectStorage)
      .useValue(new InMemoryObjectStorage())
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    http = await listenOnLoopback(app);
    root = await signPlatformToken('pa-super-admin@example.com');
  });

  afterAll(async () => {
    await app.close();
    for (const close of closers) await close();
    for (const key of [
      'JOBS_WORKER_ENABLED',
      'AUDIT_LOG_ARCHIVE_CRON',
      'FILE_MAINTENANCE_CRON',
      'AUTH_RATE_LIMIT',
    ]) {
      delete process.env[key];
    }
  });

  describe('平台管理者', () => {
    it('新增 → pending 不能登入 → 啟用信（不帶租戶）設定密碼 → 角色的權限生效', async () => {
      const created = dataOf<AdminBody>(
        await as(root, 'post', '/platform/admins')
          .send({ email: 'pa-new@example.com', displayName: '新管理者', role: 'operator' })
          .expect(201),
      );
      expect(created).toMatchObject({ role: 'operator', status: 'pending' });
      await expect(
        app
          .get(PlatformAdminService)
          .verifyCredentials({ email: 'pa-new@example.com', password: PASSWORD }),
        // 還沒設定密碼：密碼驗證不會通過，狀態不外露（與帳號不存在相同，docs/architecture/backend/04-auth.md §3.2）
      ).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });

      const token = linkToken(await waitForMail('pa-new@example.com'), '/setup');
      // 不屬於任何租戶、也不是 apps/platform 的網域（例：直接用 IP 連反向代理）也不能用
      for (const host of ['unknown.example.test', '10.0.0.5']) {
        // oxlint-disable-next-line no-await-in-loop -- 依序檢查兩種網域
        const elsewhere = await request(http)
          .post('/platform/auth/setup')
          .set('Host', host)
          .send({ token, password: PASSWORD })
          .expect(404);
        expect(errorCodeOf(elsewhere)).toBe('PLATFORM_ONLY');
        // oxlint-disable-next-line no-await-in-loop -- 同上
        const admins = await request(http)
          .get('/platform/admins')
          .set('Host', host)
          .set('authorization', `Bearer ${root}`)
          .expect(404);
        expect(errorCodeOf(admins)).toBe('PLATFORM_ONLY');
        // Express 的路由不分大小寫：換了大小寫的路徑一樣擋下（不以「沒有租戶」代替網域的判斷）
        for (const path of ['/PLATFORM/tenants', '/Platform/auth/profile']) {
          // oxlint-disable-next-line no-await-in-loop -- 同上
          const upper = await request(http)
            .get(path)
            .set('Host', host)
            .set('authorization', `Bearer ${root}`)
            .expect(404);
          expect(errorCodeOf(upper)).toBe('PLATFORM_ONLY');
        }
        // IdP 也只在 apps/platform 的網域（issuer 本來就在那裡）
        // oxlint-disable-next-line no-await-in-loop -- 同上
        const discovery = await request(http)
          .get('/oidc/.well-known/openid-configuration')
          .set('Host', host)
          .expect(404);
        expect(errorCodeOf(discovery)).toBe('PLATFORM_ONLY');
      }
      // 租戶網域上不能用
      const onTenant = await request(http)
        .post('/platform/auth/setup')
        .set('Host', HOME_HOST)
        .send({ token, password: PASSWORD })
        .expect(404);
      expect(errorCodeOf(onTenant)).toBe('PLATFORM_ONLY');
      await request(http)
        .post('/platform/auth/setup')
        .set('Host', AUTH_HOST)
        .send({ token, password: PASSWORD })
        .expect(200);
      await request(http)
        .post('/platform/auth/setup')
        .set('Host', AUTH_HOST)
        .send({ token, password: PASSWORD })
        .expect(400);

      const admin = await app
        .get(PlatformAdminService)
        .verifyCredentials({ email: 'pa-new@example.com', password: PASSWORD });
      expect(admin.status).toBe('active');
      const operator = await signPlatformToken('pa-new@example.com');
      const profile = dataOf<{ permissions: string[] }>(
        await as(operator, 'get', '/platform/auth/profile').expect(200),
      );
      expect(profile.permissions).toContain('platformJob:retry');
      expect(profile.permissions).not.toContain('platformAdmin:create');
      await as(operator, 'get', '/platform/admins').expect(200);
      await as(operator, 'post', '/platform/admins')
        .send({ email: 'x@example.com', displayName: 'X', role: 'auditor' })
        .expect(403);
    });

    it('email 重複 → USER_EMAIL_DUPLICATE；不能改自己的角色', async () => {
      const duplicate = await as(root, 'post', '/platform/admins')
        .send({ email: 'pa-auditor@example.com', displayName: 'dup', role: 'auditor' })
        .expect(409);
      expect(errorCodeOf(duplicate)).toBe('USER_EMAIL_DUPLICATE');

      const [self] = await platformDb
        .select()
        .from(platformAdmins)
        .where(eq(platformAdmins.email, 'pa-super-admin@example.com'));
      const response = await as(root, 'patch', `/platform/admins/${self!.id}`)
        .send({ role: 'auditor' })
        .expect(403);
      expect(errorCodeOf(response)).toBe('AUTHZ_SELF_MODIFY');
      // 改名可以
      await as(root, 'patch', `/platform/admins/${self!.id}`)
        .send({ displayName: '根' })
        .expect(200);
    });

    it('停用 → 既存的 token 失效；再啟用後可以重新登入', async () => {
      const auditorToken = await signPlatformToken('pa-auditor@example.com');
      await as(auditorToken, 'get', '/platform/tenants').expect(200);
      const [auditor] = await platformDb
        .select()
        .from(platformAdmins)
        .where(eq(platformAdmins.email, 'pa-auditor@example.com'));
      await as(root, 'patch', `/platform/admins/${auditor!.id}`)
        .send({ status: 'inactive' })
        .expect(200);
      const disabled = await as(auditorToken, 'get', '/platform/tenants').expect(403);
      expect(errorCodeOf(disabled)).toBe('AUTH_ACCOUNT_DISABLED');
      await expect(
        app
          .get(PlatformAdminService)
          .verifyCredentials({ email: 'pa-auditor@example.com', password: PASSWORD }),
      ).rejects.toMatchObject({ code: 'AUTH_ACCOUNT_DISABLED' });

      await as(root, 'patch', `/platform/admins/${auditor!.id}`)
        .send({ status: 'active' })
        .expect(200);
      await as(
        await signPlatformToken('pa-auditor@example.com'),
        'get',
        '/platform/tenants',
      ).expect(200);
    });

    it('寄重設密碼連結 → 設定新密碼、解鎖，舊 token 失效', async () => {
      await platformDb
        .update(platformAdmins)
        .set({ status: 'locked', lockedUntil: new Date(Date.now() + 60_000) })
        .where(eq(platformAdmins.email, 'pa-new@example.com'));
      const before = await signPlatformToken('pa-new@example.com');
      const [target] = await platformDb
        .select()
        .from(platformAdmins)
        .where(eq(platformAdmins.email, 'pa-new@example.com'));
      const sent = dataOf<{ purpose: string }>(
        await as(root, 'post', `/platform/admins/${target!.id}/password-link`).expect(200),
      );
      expect(sent.purpose).toBe('passwordReset');
      const token = linkToken(await waitForMail('pa-new@example.com', 2), '/reset-password');
      await request(http)
        .post('/platform/auth/reset-password')
        .set('Host', AUTH_HOST)
        .send({ token, newPassword: 'NewPlatformPass!2026' })
        .expect(200);
      const admin = await app
        .get(PlatformAdminService)
        .verifyCredentials({ email: 'pa-new@example.com', password: 'NewPlatformPass!2026' });
      expect(admin.status).toBe('active');
      await as(before, 'get', '/platform/auth/profile').expect(401);
    });

    it('個人資料：改自己的名稱；以目前的密碼換新密碼後所有 session 結束', async () => {
      const own = await signPlatformToken('pa-new@example.com');
      const renamed = dataOf<{ admin: { displayName: string } }>(
        await as(own, 'patch', '/platform/auth/profile')
          .send({ displayName: '  改過的名字  ' })
          .expect(200),
      );
      expect(renamed.admin.displayName).toBe('改過的名字');
      await as(own, 'patch', '/platform/auth/profile').send({ displayName: '' }).expect(400);

      const wrong = await as(own, 'post', '/platform/auth/change-password')
        .send({ currentPassword: 'not-the-password', newPassword: 'AnotherPlatform!2026' })
        .expect(400);
      expect(errorCodeOf(wrong)).toBe('AUTH_PASSWORD_MISMATCH');
      // 猜目前密碼的嘗試留下失敗的稽核（限流另見 @RateLimit('auth')）
      const [self] = await platformDb
        .select({ id: platformAdmins.id })
        .from(platformAdmins)
        .where(eq(platformAdmins.email, 'pa-new@example.com'));
      const failures = await platformDb
        .select()
        .from(platformAuditLogs)
        .where(
          and(
            eq(platformAuditLogs.action, 'platformAdmin.passwordChange'),
            eq(platformAuditLogs.resourceId, self!.id),
            eq(platformAuditLogs.result, 'failure'),
          ),
        );
      expect(failures.map((row) => row.errorCode)).toEqual(['AUTH_PASSWORD_MISMATCH']);
      const same = await as(own, 'post', '/platform/auth/change-password')
        .send({ currentPassword: 'NewPlatformPass!2026', newPassword: 'NewPlatformPass!2026' })
        .expect(400);
      expect(errorCodeOf(same)).toBe('AUTH_PASSWORD_WEAK');

      await as(own, 'post', '/platform/auth/change-password')
        .send({ currentPassword: 'NewPlatformPass!2026', newPassword: 'AnotherPlatform!2026' })
        .expect(200);
      await as(own, 'get', '/platform/auth/profile').expect(401);
      await expect(
        app
          .get(PlatformAdminService)
          .verifyCredentials({ email: 'pa-new@example.com', password: 'AnotherPlatform!2026' }),
      ).resolves.toMatchObject({ displayName: '改過的名字' });

      // 租戶網域上不能用（租戶網域只接受租戶的 token）
      const onTenant = await request(http)
        .patch('/platform/auth/profile')
        .set('Host', HOME_HOST)
        .set('authorization', `Bearer ${root}`)
        .send({ displayName: 'x' });
      expect(onTenant.status).toBeGreaterThanOrEqual(400);
    });
  });

  it('平台稽核：列出平台管理者做過的事（前綴比對）', async () => {
    const page = dataOf<{ items: Array<{ action: string; resourceType: string }> }>(
      await as(root, 'get', '/platform/audit-logs')
        .query({ action: 'platformAdmin.*' })
        .expect(200),
    );
    const actions = page.items.map((row) => row.action);
    expect(actions).toContain('platformAdmin.create');
    expect(actions.every((action) => action.startsWith('platformAdmin.'))).toBe(true);
  });

  it('背景工作：平台看得到所有租戶與平台自己的工作，可以用租戶代碼或 platform 篩選', async () => {
    const queues = dataOf<{ items: Array<{ name: string; scope: string }> }>(
      await as(root, 'get', '/platform/jobs/queues').expect(200),
    );
    expect(queues.items.find((q) => q.name === 'platformAdmin.accountMail')?.scope).toBe(
      'platform',
    );
    expect(queues.items.find((q) => q.name === 'auth.activationMail')?.scope).toBe('tenant');

    const platformJobs = dataOf<{ items: Array<{ name: string; tenantId: string | null }> }>(
      await as(root, 'get', '/platform/jobs').query({ tenant: 'platform' }).expect(200),
    );
    expect(platformJobs.items.some((job) => job.name === 'platformAdmin.accountMail')).toBe(true);
    expect(platformJobs.items.every((job) => job.tenantId === null)).toBe(true);

    const unknown = dataOf<{ items: unknown[] }>(
      await as(root, 'get', '/platform/jobs').query({ tenant: 'no-such-tenant' }).expect(200),
    );
    expect(unknown.items).toEqual([]);
  });

  it('外部 IdP（identityProvider）：關掉後租戶的 /identity-providers 回 404；打開後恢復（docs/architecture/05-tenancy.md §12.2 D5）', async () => {
    const tenantId = (await testTenantContext(app)).id;
    const login = await request(http)
      .post('/auth/login')
      .set('Host', HOME_HOST)
      .send(ROOT)
      .expect(200);
    const tenantToken = (login.body as { data: { accessToken: string } }).data.accessToken;
    const provider = {
      name: 'Acme AD',
      issuer: 'https://login.acme.test',
      clientId: 'b2b',
      clientSecret: 'secret',
      domains: [{ domain: 'acme-idp.test', ssoOnly: false }],
    };
    const tenantRequest = (method: 'get' | 'post', path: string) => {
      const agent = request(http);
      return (method === 'get' ? agent.get(path) : agent.post(path))
        .set('Host', HOME_HOST)
        .set('authorization', `Bearer ${tenantToken}`);
    };
    const others = ALL_FEATURES.filter((feature) => feature !== 'identityProvider');

    const off = dataOf<{ features: string[] }>(
      await as(root, 'patch', `/platform/tenants/${tenantId}`)
        .send({ features: others })
        .expect(200),
    );
    expect(off.features).toEqual(others);
    const denied = await tenantRequest('post', '/identity-providers').send(provider).expect(404);
    expect(errorCodeOf(denied)).toBe('FEATURE_DISABLED');
    await tenantRequest('get', '/identity-providers').expect(404);

    await as(root, 'patch', `/platform/tenants/${tenantId}`)
      .send({ features: ALL_FEATURES })
      .expect(200);
    await tenantRequest('post', '/identity-providers').send(provider).expect(201);
    const [row] = await platformDb.select().from(tenants).where(eq(tenants.id, tenantId));
    expect(row?.features).toContain('identityProvider');
  });

  it('feature 參數：平台設定後租戶的外部 IdP 上限與檔案容量立即生效；不合法的值回 400（docs/architecture/05-tenancy.md §13）', async () => {
    const tenantId = (await testTenantContext(app)).id;
    const login = await request(http)
      .post('/auth/login')
      .set('Host', HOME_HOST)
      .send(ROOT)
      .expect(200);
    const tenantToken = (login.body as { data: { accessToken: string } }).data.accessToken;
    const tenantRequest = (method: 'get' | 'post', path: string) => {
      const agent = request(http);
      return (method === 'get' ? agent.get(path) : agent.post(path))
        .set('Host', HOME_HOST)
        .set('authorization', `Bearer ${tenantToken}`);
    };
    type Param = { key: string; value: number; overridden: boolean };
    const paramOf = (tenant: { featureParams: Param[] }, key: string) =>
      tenant.featureParams.find((param) => param.key === key);

    try {
      const providers = dataOf<{ items: unknown[] }>(
        await tenantRequest('get', '/identity-providers').expect(200),
      ).items.length;
      const updated = dataOf<{ featureParams: Param[] }>(
        await as(root, 'patch', `/platform/tenants/${tenantId}`)
          .send({
            featureParams: {
              'identityProvider.maxProviders': Math.max(1, providers),
              'file.storageQuotaMb': 1,
            },
          })
          .expect(200),
      );
      expect(paramOf(updated, 'file.storageQuotaMb')).toMatchObject({
        value: 1,
        overridden: true,
      });
      expect(paramOf(updated, 'webhook.maxUrls')).toMatchObject({ value: 1, overridden: false });

      if (providers >= 1) {
        const full = await tenantRequest('post', '/identity-providers')
          .send({
            name: 'One Too Many',
            issuer: 'https://login.too-many.test',
            clientId: 'b2b',
            clientSecret: 'secret',
            domains: [],
          })
          .expect(409);
        expect(errorCodeOf(full)).toBe('IDENTITY_PROVIDER_LIMIT_REACHED');
      }

      const policy = dataOf<{ storageQuota: number }>(
        await tenantRequest('get', '/files/upload-policy').expect(200),
      );
      expect(policy.storageQuota).toBe(1024 * 1024);
      const tooBig = await tenantRequest('post', '/files')
        .send({ name: 'big.bin', contentType: 'application/octet-stream', size: 2 * 1024 * 1024 })
        .expect(409);
      expect(errorCodeOf(tooBig)).toBe('FILE_STORAGE_QUOTA_EXCEEDED');

      const invalid = await as(root, 'patch', `/platform/tenants/${tenantId}`)
        .send({ featureParams: { 'job.maxConcurrency': 0 } })
        .expect(400);
      expect(errorCodeOf(invalid)).toBe('VALIDATION_FAILED');

      const reset = dataOf<{ featureParams: Param[] }>(
        await as(root, 'patch', `/platform/tenants/${tenantId}`)
          .send({
            featureParams: { 'identityProvider.maxProviders': null, 'file.storageQuotaMb': null },
          })
          .expect(200),
      );
      expect(reset.featureParams.every((param) => !param.overridden)).toBe(true);
      const [row] = await platformDb.select().from(tenants).where(eq(tenants.id, tenantId));
      expect(row?.featureParams).toEqual({});
    } finally {
      await platformDb.update(tenants).set({ featureParams: {} }).where(eq(tenants.id, tenantId));
      app.get(TenantDirectory).invalidate();
    }
  });

  it('回收桶與系統設定：關掉後列表、還原、設定頁的端點回 404，公開設定照舊（docs/architecture/05-tenancy.md §12.2 D3、D4）', async () => {
    const tenantId = (await testTenantContext(app)).id;
    const login = await request(http)
      .post('/auth/login')
      .set('Host', HOME_HOST)
      .send(ROOT)
      .expect(200);
    const tenantToken = (login.body as { data: { accessToken: string } }).data.accessToken;
    const tenantRequest = (method: 'get' | 'post', path: string) => {
      const agent = request(http);
      return (method === 'get' ? agent.get(path) : agent.post(path))
        .set('Host', HOME_HOST)
        .set('authorization', `Bearer ${tenantToken}`);
    };
    const others = ALL_FEATURES.filter(
      (feature) => feature !== 'trash' && feature !== 'systemSetting',
    );

    await as(root, 'patch', `/platform/tenants/${tenantId}`).send({ features: others }).expect(200);
    expect(
      errorCodeOf(await tenantRequest('get', '/trash').query({ type: 'user' }).expect(404)),
    ).toBe('FEATURE_DISABLED');
    expect(
      errorCodeOf(
        await tenantRequest('post', '/users/00000000-0000-4000-8000-000000000000/restore').expect(
          404,
        ),
      ),
    ).toBe('FEATURE_DISABLED');
    expect(errorCodeOf(await tenantRequest('get', '/system/settings').expect(404))).toBe(
      'FEATURE_DISABLED',
    );
    await request(http).get('/system/settings/public').set('Host', HOME_HOST).expect(200);

    await as(root, 'patch', `/platform/tenants/${tenantId}`)
      .send({ features: ALL_FEATURES })
      .expect(200);
    await tenantRequest('get', '/trash').query({ type: 'user' }).expect(200);
    await tenantRequest('get', '/system/settings').expect(200);
  });

  it('啟用的 feature：關掉 file 後租戶的 /files 回 404 FEATURE_DISABLED、profile 不含 file；打開後恢復（docs/architecture/frontend/02-plugin-system.md §9.2 D8、D11）', async () => {
    const tenantId = (await testTenantContext(app)).id;
    const login = await request(http)
      .post('/auth/login')
      .set('Host', HOME_HOST)
      .send(ROOT)
      .expect(200);
    const tenantToken = (login.body as { data: { accessToken: string } }).data.accessToken;
    const tenantGet = (path: string) =>
      request(http).get(path).set('Host', HOME_HOST).set('authorization', `Bearer ${tenantToken}`);
    const featuresOfProfile = async () =>
      dataOf<{ features: string[] }>(await tenantGet('/auth/profile').expect(200)).features;

    expect(await featuresOfProfile()).toEqual(ALL_FEATURES);

    const off = dataOf<{ features: string[] }>(
      await as(root, 'patch', `/platform/tenants/${tenantId}`)
        .send({ features: ['job', 'auditLog'] })
        .expect(200),
    );
    expect(off.features).toEqual(['auditLog', 'job']);

    const disabled = await tenantGet('/files').expect(404);
    expect(errorCodeOf(disabled)).toBe('FEATURE_DISABLED');
    expect(errorCodeOf(await tenantGet('/file-folders').expect(404))).toBe('FEATURE_DISABLED');
    // 未登入照舊 401：不讓未登入者知道這個租戶有沒有開這個功能
    await request(http).get('/files').set('Host', HOME_HOST).expect(401);
    // 其他 feature 與常駐的端點不受影響
    await tenantGet('/audit-logs').expect(200);
    await tenantGet('/users').expect(200);
    expect(await featuresOfProfile()).toEqual(['auditLog', 'job']);

    const audits = dataOf<{ items: Array<{ action: string; metadata: Record<string, unknown> }> }>(
      await as(root, 'get', '/platform/audit-logs').query({ action: 'tenant.update' }).expect(200),
    );
    expect(
      audits.items.find(
        (entry) => (entry.metadata.after as { features?: string[] }).features?.length === 2,
      )?.metadata.before,
    ).toMatchObject({ features: ALL_FEATURES });

    // 重複的值直接拒絕；未知的 id 也拒絕
    await as(root, 'patch', `/platform/tenants/${tenantId}`)
      .send({ features: ['file', 'file'] })
      .expect(400);
    await as(root, 'patch', `/platform/tenants/${tenantId}`)
      .send({ features: ['nope'] })
      .expect(400);

    await as(root, 'patch', `/platform/tenants/${tenantId}`)
      .send({ features: ALL_FEATURES })
      .expect(200);
    await tenantGet('/files').expect(200);
    expect(await featuresOfProfile()).toEqual(ALL_FEATURES);
    const [row] = await platformDb.select().from(tenants).where(eq(tenants.id, tenantId));
    expect(row?.features).toEqual(ALL_FEATURES);
  });
});
