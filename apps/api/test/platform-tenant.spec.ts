import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';

import type { Env } from '@/core/config';
import { SecretBox, TENANT_SECRET_PURPOSE } from '@/core/crypto';
import { fullSchema } from '@/core/database';
import { MailTransport } from '@/core/mail';
import type { MailMessage, SentMail } from '@/core/mail';
import { ObjectStorage } from '@/core/storage';
import { platformAdmins, tenants } from '@/db/platform/schema';
import type { PlatformAdminRole } from '@/db/platform/schema';
import { permissions, refreshTokens, roles, users } from '@/db/schema';
import { upsertPlatformAdmin } from '@/db/seeds/platform-admin';
import { TenantProvisioner } from '@/modules/tenant/tenant-provisioner';

import type { PlatformTestDatabase } from './db';
import { createPlatformTestDatabase } from './db';
import { InMemoryObjectStorage } from './in-memory-object-storage';

class RecordingMailTransport extends MailTransport {
  readonly sent: MailMessage[] = [];

  send(message: MailMessage): Promise<SentMail> {
    this.sent.push(message);
    return Promise.resolve({ messageId: `<${this.sent.length}@test>` });
  }
}

/** apps/auth 的網域（AUTH_APP_URL 的預設值）：不屬於任何租戶。 */
const AUTH_HOST = 'localhost:5175';
/** 測試租戶的網域（test/global-setup.ts）。 */
const HOME_HOST = '127.0.0.1';
const ADMIN_PASSWORD = 'AcmeAdmin!Pass2026';

let app: INestApplication;
let http: App;
let platformDb: PlatformTestDatabase;
let closePlatform: () => Promise<void>;
const mailbox = new RecordingMailTransport();
const storage = new InMemoryObjectStorage();
const tokens = new Map<PlatformAdminRole, string>();

interface TenantBody {
  id: string;
  code: string;
  status: string;
  domains: string[];
  storageBucket: string;
  provisionError: string | null;
}

function dataOf<T>(response: { body: unknown }): T {
  return (response.body as { data: T }).data;
}

function errorCodeOf(response: { body: unknown }): string | undefined {
  return (response.body as { error?: { code?: string } }).error?.code;
}

function platform(
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  role: PlatformAdminRole = 'super-admin',
) {
  return request(http)
    [method](path)
    .set('Host', AUTH_HOST)
    .set('authorization', `Bearer ${tokens.get(role)}`);
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

async function waitForStatus(id: string, status: string): Promise<TenantBody> {
  return vi.waitFor(
    async () => {
      const tenant = dataOf<TenantBody>(
        await platform('get', `/platform/tenants/${id}`).expect(200),
      );
      expect(tenant.status).toBe(status);
      return tenant;
    },
    { timeout: 30_000, interval: 250 },
  );
}

async function tenantDb(id: string) {
  const [row] = await platformDb.select().from(tenants).where(eq(tenants.id, id));
  if (!row) throw new Error('找不到租戶');
  const box = SecretBox.fromConfig(inject('tenantSecretKey'), '', TENANT_SECRET_PURPOSE);
  const client = postgres(box.decrypt(row.databaseUrlEncrypted), { max: 1, onnotice: () => {} });
  return { db: drizzle(client, { schema: fullSchema }), close: () => client.end() };
}

describe('租戶的建立與佈建（docs/adr/0020-physical-tenant-isolation.md D12、D13）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.JOBS_WORKER_ENABLED = 'true';
    process.env.AUDIT_LOG_ARCHIVE_CRON = '';
    process.env.FILE_MAINTENANCE_CRON = '';
    process.env.AUTH_RATE_LIMIT = '1000';

    const created = createPlatformTestDatabase();
    platformDb = created.db;
    closePlatform = async () => created.client.end();
    for (const role of ['super-admin', 'auditor'] as const) {
      await upsertPlatformAdmin(platformDb, {
        email: `tenant-${role}@example.com`,
        displayName: role,
        password: 'PlatformPassword!2026',
        role,
      });
    }

    const { AppModule } = await import('@/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailTransport)
      .useValue(mailbox)
      .overrideProvider(ObjectStorage)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    http = app.getHttpServer() as App;
    for (const role of ['super-admin', 'auditor'] as const) {
      tokens.set(role, await signPlatformToken(`tenant-${role}@example.com`));
    }
  });

  afterAll(async () => {
    await app.close();
    await closePlatform();
    for (const key of [
      'JOBS_WORKER_ENABLED',
      'AUDIT_LOG_ARCHIVE_CRON',
      'FILE_MAINTENANCE_CRON',
      'AUTH_RATE_LIMIT',
    ]) {
      delete process.env[key];
    }
  });

  it('權限：auditor 只能看；租戶網域上一律 PLATFORM_ONLY', async () => {
    await platform('get', '/platform/tenants', 'auditor').expect(200);
    const denied = await platform('post', '/platform/tenants', 'auditor')
      .send({ code: 'nope', name: 'Nope', adminEmail: 'nope@example.com' })
      .expect(403);
    expect(errorCodeOf(denied)).toBe('AUTHZ_FORBIDDEN');

    const onTenant = await request(http)
      .get('/platform/tenants')
      .set('Host', HOME_HOST)
      .set('authorization', `Bearer ${tokens.get('super-admin')}`)
      .expect(404);
    expect(errorCodeOf(onTenant)).toBe('PLATFORM_ONLY');
  });

  it('建立 → 背景佈建 → 啟用信 → 第一位管理員設定密碼後在租戶網域登入', async () => {
    const response = await platform('post', '/platform/tenants')
      .send({ code: 'acme', name: 'Acme 股份有限公司', adminEmail: 'owner@acme.test' })
      .expect(201);
    const created = dataOf<TenantBody>(response);
    expect(created).toMatchObject({
      code: 'acme',
      status: 'provisioning',
      domains: ['acme.localhost:5173'],
      storageBucket: 'b2b-acme',
    });

    await waitForStatus(created.id, 'active');

    // 新租戶有自己的 database：權限目錄、系統角色、pending 的 super-admin
    const acme = await tenantDb(created.id);
    try {
      expect((await acme.db.select().from(permissions)).length).toBeGreaterThan(0);
      expect((await acme.db.select().from(roles)).map((role) => role.slug)).toContain(
        'super-admin',
      );
      const [owner] = await acme.db.select().from(users).where(eq(users.email, 'owner@acme.test'));
      expect(owner?.status).toBe('pending');
    } finally {
      await acme.close();
    }

    const mail = await vi.waitFor(
      () => {
        const message = mailbox.sent.find((m) => m.to === 'owner@acme.test');
        expect(message).toBeDefined();
        return message!;
      },
      { timeout: 20_000, interval: 200 },
    );
    const match = /\/setup\?token=([\w-]+)&tenant=acme/.exec(mail.text);
    expect(match).not.toBeNull();

    await request(http)
      .post('/auth/setup')
      .set('Host', AUTH_HOST)
      .set('X-Tenant', 'acme')
      .send({ token: match![1], password: ADMIN_PASSWORD })
      .expect(200);
    await request(http)
      .post('/auth/login')
      .set('Host', 'acme.localhost:5173')
      .send({ email: 'owner@acme.test', password: ADMIN_PASSWORD })
      .expect(200);
    // 同一組帳密在別的租戶不存在
    await request(http)
      .post('/auth/login')
      .set('Host', HOME_HOST)
      .send({ email: 'owner@acme.test', password: ADMIN_PASSWORD })
      .expect(401);
  });

  it('代碼與網域不能重複；apps/auth 的網域不能登記給租戶', async () => {
    const taken = await platform('post', '/platform/tenants')
      .send({ code: 'acme', name: 'Acme 2', adminEmail: 'x@example.com' })
      .expect(409);
    expect(errorCodeOf(taken)).toBe('TENANT_CODE_TAKEN');

    const domain = await platform('post', '/platform/tenants')
      .send({ code: 'beta', name: 'Beta', adminEmail: 'x@example.com', domains: [HOME_HOST] })
      .expect(409);
    expect(errorCodeOf(domain)).toBe('TENANT_DOMAIN_TAKEN');

    const auth = await platform('post', '/platform/tenants')
      .send({ code: 'beta', name: 'Beta', adminEmail: 'x@example.com', domains: [AUTH_HOST] })
      .expect(409);
    expect(errorCodeOf(auth)).toBe('TENANT_DOMAIN_TAKEN');

    const reserved = await platform('post', '/platform/tenants')
      .send({ code: 'auth', name: 'Auth', adminEmail: 'x@example.com' })
      .expect(400);
    expect(errorCodeOf(reserved)).toBe('VALIDATION_FAILED');
  });

  it('網域：新增的網域立即生效；不能移除最後一個', async () => {
    const [acme] = dataOf<{ items: TenantBody[] }>(
      await platform('get', '/platform/tenants').expect(200),
    ).items.filter((t) => t.code === 'acme');
    const withDomain = dataOf<TenantBody>(
      await platform('post', `/platform/tenants/${acme!.id}/domains`)
        .send({ domain: 'portal.acme.test' })
        .expect(200),
    );
    expect(withDomain.domains).toEqual(['acme.localhost:5173', 'portal.acme.test']);
    await request(http)
      .post('/auth/login')
      .set('Host', 'portal.acme.test')
      .send({ email: 'owner@acme.test', password: ADMIN_PASSWORD })
      .expect(200);

    await platform('delete', `/platform/tenants/${acme!.id}/domains/portal.acme.test`).expect(200);
    const last = await platform(
      'delete',
      `/platform/tenants/${acme!.id}/domains/acme.localhost:5173`,
    ).expect(409);
    expect(errorCodeOf(last)).toBe('TENANT_LAST_DOMAIN');
  });

  it('停用：網域回 503、session 全部撤銷；啟用後恢復', async () => {
    const [acme] = dataOf<{ items: TenantBody[] }>(
      await platform('get', '/platform/tenants').expect(200),
    ).items.filter((t) => t.code === 'acme');
    const id = acme!.id;

    await platform('post', `/platform/tenants/${id}/disable`).expect(200);
    const down = await request(http)
      .post('/auth/login')
      .set('Host', 'acme.localhost:5173')
      .send({ email: 'owner@acme.test', password: ADMIN_PASSWORD })
      .expect(503);
    expect(errorCodeOf(down)).toBe('TENANT_UNAVAILABLE');
    const db = await tenantDb(id);
    try {
      const sessions = await db.db.select().from(refreshTokens);
      expect(sessions.length).toBeGreaterThan(0);
      for (const session of sessions) expect(session.revokedReason).toBe('tenant_disabled');
    } finally {
      await db.close();
    }

    const again = await platform('post', `/platform/tenants/${id}/disable`).expect(409);
    expect(errorCodeOf(again)).toBe('TENANT_STATUS_CONFLICT');

    await platform('post', `/platform/tenants/${id}/enable`).expect(200);
    await request(http)
      .post('/auth/login')
      .set('Host', 'acme.localhost:5173')
      .send({ email: 'owner@acme.test', password: ADMIN_PASSWORD })
      .expect(200);
  });

  it('佈建失敗停在 failed、記下原因；重試回到佈建中', async () => {
    const box = SecretBox.fromConfig(inject('tenantSecretKey'), '', TENANT_SECRET_PURPOSE);
    const [broken] = await platformDb
      .insert(tenants)
      .values({
        code: 'broken',
        name: 'Broken',
        status: 'provisioning',
        // 密碼格式不對：佈建在建立 DB 角色之前就失敗
        databaseUrlEncrypted: box.encrypt('postgres://tenant_broken:x@127.0.0.1:1/tenant_broken'),
        storageBucket: 'b2b-broken',
      })
      .returning();
    await app.get(TenantProvisioner).provision(broken!.id);

    const failed = dataOf<TenantBody>(
      await platform('get', `/platform/tenants/${broken!.id}`).expect(200),
    );
    expect(failed.status).toBe('failed');
    expect(failed.provisionError).toContain('密碼格式');

    const retried = dataOf<TenantBody>(
      await platform('post', `/platform/tenants/${broken!.id}/provision`).expect(200),
    );
    expect(retried.status).toBe('provisioning');
    await waitForStatus(broken!.id, 'failed');
  });

  it('刪除：從清單消失、網域釋出（回 TENANT_NOT_FOUND）；代碼可以再用', async () => {
    const [acme] = dataOf<{ items: TenantBody[] }>(
      await platform('get', '/platform/tenants').expect(200),
    ).items.filter((t) => t.code === 'acme');
    await platform('delete', `/platform/tenants/${acme!.id}`, 'auditor').expect(403);
    await platform('delete', `/platform/tenants/${acme!.id}`).expect(204);

    const list = dataOf<{ items: TenantBody[] }>(await platform('get', '/platform/tenants'));
    expect(list.items.map((t) => t.code)).not.toContain('acme');
    const gone = await request(http)
      .post('/auth/login')
      .set('Host', 'acme.localhost:5173')
      .send({ email: 'owner@acme.test', password: ADMIN_PASSWORD })
      .expect(404);
    expect(errorCodeOf(gone)).toBe('TENANT_NOT_FOUND');

    // 新的 acme 用新的 bucket（舊的可能還沒清）
    const reborn = dataOf<TenantBody>(
      await platform('post', '/platform/tenants')
        .send({ code: 'acme', name: 'Acme 重建', adminEmail: 'owner@acme.test' })
        .expect(201),
    );
    expect(reborn.storageBucket).toBe('b2b-acme-2');
    await waitForStatus(reborn.id, 'active');
  });
});
