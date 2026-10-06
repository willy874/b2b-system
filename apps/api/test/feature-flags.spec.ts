import { randomUUID } from 'node:crypto';

import { Controller, Get } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RequireFlag, RequirePermissions } from '@/common/decorators';
import type { Env } from '@/core/config';
import { FEATURE_FLAG_CATALOG } from '@/core/feature-flags';
import type { FeatureFlagDefinition } from '@/core/feature-flags';
import { MailTransport } from '@/core/mail';
import { ObjectStorage } from '@/core/storage';
import { featureFlagOverrides, platformAdmins, tenants } from '@/db/platform/schema';
import { upsertPlatformAdmin } from '@/db/seeds/platform-admin';

import type { PlatformTestDatabase, TestDatabase } from './db';
import { createPlatformTestDatabase, createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { InMemoryObjectStorage } from './in-memory-object-storage';
import { testTenantContext } from './tenant';

/** 目錄平常是空的：測試換成自己的目錄（D1），並掛一個試行中的端點驗證 guard。 */
const CATALOG: FeatureFlagDefinition[] = [
  {
    key: 'levelEditor.v2',
    description: '新版關卡編輯器',
    defaultEnabled: false,
    owner: 'content',
    removeBy: '2099-01-01',
  },
  {
    key: 'user.bulkInvite',
    description: '批次邀請',
    defaultEnabled: true,
    owner: 'identity',
    removeBy: '2099-01-01',
  },
];

@Controller('trial')
class TrialController {
  @Get()
  @RequireFlag('levelEditor.v2')
  @RequirePermissions('user:read')
  list() {
    return { ok: true };
  }
}

const AUTH_HOST = 'localhost:5175';
const HOME_HOST = '127.0.0.1';
const PASSWORD = 'PlatformPassword!2026';
const ROOT = { email: 'ff-root@example.com', password: 'Quiet-Harbor-Lantern-26' };

let app: INestApplication;
let http: App;
let platformDb: PlatformTestDatabase;
let home: TestDatabase;
let tenantId: string;
let operator: string;
let auditor: string;
let tenantToken: string;
const closers: Array<() => Promise<void>> = [];

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

function as(token: string, method: 'get' | 'put' | 'patch', path: string) {
  return request(http)[method](path).set('Host', AUTH_HOST).set('authorization', `Bearer ${token}`);
}

const tenantGet = (path: string) =>
  request(http).get(path).set('Host', HOME_HOST).set('authorization', `Bearer ${tenantToken}`);

async function profileFlags(): Promise<string[]> {
  return dataOf<{ flags: string[] }>(await tenantGet('/auth/profile').expect(200)).flags;
}

function setGlobal(state: 'on' | 'off' | 'default') {
  return as(operator, 'put', '/platform/feature-flags/levelEditor.v2').send({ state });
}

function setTenantFlags(flags: Record<string, boolean>) {
  return as(operator, 'patch', `/platform/tenants/${tenantId}`).send({ flags });
}

describe('feature flag（docs/architecture/05-tenancy.md §11）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = ROOT.email;
    process.env.SUPER_ADMIN_PASSWORD = ROOT.password;
    process.env.AUTH_RATE_LIMIT = '1000';

    const platform = createPlatformTestDatabase();
    platformDb = platform.db;
    closers.push(async () => platform.client.end());
    for (const role of ['operator', 'auditor'] as const) {
      // oxlint-disable-next-line no-await-in-loop -- 依序建立兩個管理者
      await upsertPlatformAdmin(platformDb, {
        email: `ff-${role}@example.com`,
        displayName: role,
        password: PASSWORD,
        role,
      });
    }
    await platformDb.delete(featureFlagOverrides);

    const tenantDb = createTestDatabase();
    home = tenantDb.db;
    closers.push(async () => tenantDb.client.end());
    await truncateAll(home);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(home as never);

    const { AppModule } = await import('@/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TrialController],
    })
      .overrideProvider(FEATURE_FLAG_CATALOG)
      .useValue(CATALOG)
      .overrideProvider(MailTransport)
      .useValue({ send: () => Promise.resolve({ messageId: '<x@test>' }) })
      .overrideProvider(ObjectStorage)
      .useValue(new InMemoryObjectStorage())
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    http = await listenOnLoopback(app);

    tenantId = (await testTenantContext(app)).id;
    await platformDb.update(tenants).set({ flags: {} }).where(eq(tenants.id, tenantId));
    operator = await signPlatformToken('ff-operator@example.com');
    auditor = await signPlatformToken('ff-auditor@example.com');
    const login = await request(http)
      .post('/auth/login')
      .set('Host', HOME_HOST)
      .send(ROOT)
      .expect(200);
    tenantToken = (login.body as { data: { accessToken: string } }).data.accessToken;
  });

  afterAll(async () => {
    // 共用的測試租戶與平台 DB：還原，不影響其他測試檔
    await platformDb.delete(featureFlagOverrides);
    await platformDb.update(tenants).set({ flags: {} }).where(eq(tenants.id, tenantId));
    await app.close();
    for (const close of closers) await close();
    delete process.env.AUTH_RATE_LIMIT;
  });

  it('預設值：profile 只列生效為開的 flag；試行中的端點關閉時回 404，未登入照舊 401', async () => {
    expect(await profileFlags()).toEqual(['user.bulkInvite']);
    expect(errorCodeOf(await tenantGet('/trial').expect(404))).toBe('FEATURE_DISABLED');
    await request(http).get('/trial').set('Host', HOME_HOST).expect(401);
  });

  it('租戶層：只給這個租戶開；覆寫表是取代語意；不認得的 key 回 400', async () => {
    const updated = dataOf<{ flags: Record<string, boolean> }>(
      await setTenantFlags({ 'levelEditor.v2': true, 'user.bulkInvite': false }).expect(200),
    );
    expect(updated.flags).toEqual({ 'levelEditor.v2': true, 'user.bulkInvite': false });
    expect(await profileFlags()).toEqual(['levelEditor.v2']);
    await tenantGet('/trial').expect(200);

    const replaced = dataOf<{ flags: Record<string, boolean> }>(
      await setTenantFlags({ 'levelEditor.v2': true }).expect(200),
    );
    expect(replaced.flags).toEqual({ 'levelEditor.v2': true });
    expect(await profileFlags()).toEqual(['levelEditor.v2', 'user.bulkInvite']);

    const unknown = await setTenantFlags({ 'gone.flag': true }).expect(400);
    expect(errorCodeOf(unknown)).toBe('VALIDATION_FAILED');

    const audits = dataOf<{ items: Array<{ metadata: Record<string, unknown> }> }>(
      await as(operator, 'get', '/platform/audit-logs')
        .query({ action: 'tenant.update' })
        .expect(200),
    );
    expect(audits.items[0]?.metadata).toMatchObject({
      before: { flags: { 'levelEditor.v2': true, 'user.bulkInvite': false } },
      after: { flags: { 'levelEditor.v2': true } },
    });
  });

  it('全平台 off 是緊急開關：蓋過租戶層；回到 default 後恢復租戶層', async () => {
    await setTenantFlags({ 'levelEditor.v2': true }).expect(200);

    const off = dataOf<{ globalState: string | null; tenantOverrides: { on: number } }>(
      await setGlobal('off').expect(200),
    );
    expect(off.globalState).toBe('off');
    expect(off.tenantOverrides.on).toBeGreaterThanOrEqual(1);
    expect(await profileFlags()).not.toContain('levelEditor.v2');
    expect(errorCodeOf(await tenantGet('/trial').expect(404))).toBe('FEATURE_DISABLED');

    await setGlobal('default').expect(200);
    expect(await profileFlags()).toContain('levelEditor.v2');
    await tenantGet('/trial').expect(200);
  });

  it('全平台 on 是全面開放：租戶層仍可以個別關掉', async () => {
    await setTenantFlags({}).expect(200);
    await setGlobal('on').expect(200);
    expect(await profileFlags()).toContain('levelEditor.v2');

    await setTenantFlags({ 'levelEditor.v2': false }).expect(200);
    expect(await profileFlags()).not.toContain('levelEditor.v2');

    const [row] = await platformDb
      .select()
      .from(featureFlagOverrides)
      .where(eq(featureFlagOverrides.key, 'levelEditor.v2'));
    expect(row?.state).toBe('on');
    await setGlobal('default').expect(200);
    await setTenantFlags({}).expect(200);
  });

  it('列表與權限：auditor 看得到、不能切換；不在目錄裡的 key 回 404；稽核寫 featureFlag.update', async () => {
    const list = dataOf<{ items: Array<{ key: string; globalState: string | null }> }>(
      await as(auditor, 'get', '/platform/feature-flags').expect(200),
    );
    expect(list.items.map((item) => item.key)).toEqual(['levelEditor.v2', 'user.bulkInvite']);

    await as(auditor, 'put', '/platform/feature-flags/levelEditor.v2')
      .send({ state: 'off' })
      .expect(403);
    const missing = await as(operator, 'put', '/platform/feature-flags/gone.flag')
      .send({ state: 'on' })
      .expect(404);
    expect(errorCodeOf(missing)).toBe('FEATURE_FLAG_NOT_FOUND');
    await as(operator, 'put', '/platform/feature-flags/levelEditor.v2')
      .send({ state: 'maybe' })
      .expect(400);

    const audits = dataOf<{ items: Array<{ metadata: Record<string, unknown> }> }>(
      await as(operator, 'get', '/platform/audit-logs')
        .query({ action: 'featureFlag.update' })
        .expect(200),
    );
    expect(audits.items[0]?.metadata).toMatchObject({
      key: 'levelEditor.v2',
      before: 'on',
      after: 'default',
    });

    // 租戶網域上不能用
    const onTenant = await request(http)
      .get('/platform/feature-flags')
      .set('Host', HOME_HOST)
      .set('authorization', `Bearer ${operator}`)
      .expect(404);
    expect(errorCodeOf(onTenant)).toBe('PLATFORM_ONLY');
  });
});
