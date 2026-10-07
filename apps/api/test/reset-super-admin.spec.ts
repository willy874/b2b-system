import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  RESET_LINK_TTL_SECONDS,
  resetSuperAdmin,
  SUPER_ADMIN_RESET_ACTION,
} from '@/cli/reset-super-admin';
import { MailTransport } from '@/core/mail';
import type { MailMessage, SentMail } from '@/core/mail';
import { ObjectStorage } from '@/core/storage';
import { platformAdmins, platformAuditLogs } from '@/db/platform/schema';
import { auditLogs, authTokens, relationTuples, roleHolderTuple, roles, users } from '@/db/schema';
import { upsertPlatformAdmin } from '@/db/seeds/platform-admin';
import { hashPassword } from '@/modules/credential/password';

import type { PlatformTestDatabase, TestDatabase } from './db';
import { createPlatformTestDatabase, createTestDatabase, truncateAll } from './db';
import { TEST_TENANT } from './global-setup';
import { listenOnLoopback } from './http';
import { InMemoryObjectStorage } from './in-memory-object-storage';

/** 寄信不通是這支指令的前提：測試裡不寄任何信。 */
class SilentMailTransport extends MailTransport {
  send(_message: MailMessage): Promise<SentMail> {
    return Promise.resolve({ messageId: '<silent@test>' });
  }
}

const AUTH_HOST = 'localhost:5175';
const ROOT = { email: 'cli-root@example.com', password: 'Quiet-Harbor-Lantern-26' };
const NEW_PASSWORD = 'Recovered-Harbor-Lantern-31';
/** 測試的平台 DB 名稱（global-setup）；container 不一定被視為本機，一律帶上確認。 */
const CONFIRM = 'b2b_platform_test';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let platformDb: PlatformTestDatabase;
const closers: Array<() => Promise<void>> = [];

function tokenOf(link: string): string {
  const token = new URL(link).searchParams.get('token');
  if (!token) throw new Error(`連結沒有 token：${link}`);
  return token;
}

const resetTenant = (email: string) =>
  resetSuperAdmin({ target: { tenant: TEST_TENANT.code }, email, confirm: CONFIRM });

async function createTenantUser(
  email: string,
  options: { superAdmin?: boolean; status?: 'pending' | 'active' | 'inactive' } = {},
): Promise<string> {
  const status = options.status ?? 'active';
  const [user] = await db
    .insert(users)
    .values({
      email,
      displayName: email,
      passwordHash: status === 'pending' ? null : await hashPassword('Forgotten-Password-2026'),
      status,
    })
    .returning();
  if (options.superAdmin) {
    const [role] = await db.select().from(roles).where(eq(roles.slug, 'super-admin'));
    await db.insert(relationTuples).values(roleHolderTuple(role!.id, user!.id));
  }
  return user!.id;
}

describe('cli:reset-super-admin（docs/architecture/iam/05-bootstrap.md §7）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = ROOT.email;
    process.env.SUPER_ADMIN_PASSWORD = ROOT.password;
    process.env.AUTH_RATE_LIMIT = '1000';

    const tenant = createTestDatabase();
    db = tenant.db;
    closers.push(async () => tenant.client.end());
    const platform = createPlatformTestDatabase();
    platformDb = platform.db;
    closers.push(async () => platform.client.end());
    await truncateAll(db);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);

    const { AppModule } = await import('@/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailTransport)
      .useValue(new SilentMailTransport())
      .overrideProvider(ObjectStorage)
      .useValue(new InMemoryObjectStorage())
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    http = await listenOnLoopback(app);
  });

  afterAll(async () => {
    await app.close();
    for (const close of closers) await close();
    delete process.env.AUTH_RATE_LIMIT;
  });

  describe('租戶的 super-admin（--tenant）', () => {
    it('簽出的重設連結走 POST /auth/reset-password 完成重設，並寫 system.super_admin_reset_requested 稽核', async () => {
      const [root] = await db.select().from(users).where(eq(users.email, ROOT.email));
      const before = Date.now();
      const result = await resetTenant(ROOT.email);

      expect(result.purpose).toBe('password_reset');
      const link = new URL(result.link);
      expect(link.pathname).toBe('/reset-password');
      expect(link.searchParams.get('tenant')).toBe(TEST_TENANT.code);
      expect(result.expiresAt.getTime() - before).toBeLessThanOrEqual(
        RESET_LINK_TTL_SECONDS * 1000 + 5_000,
      );

      const [audit] = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, SUPER_ADMIN_RESET_ACTION));
      expect(audit).toMatchObject({
        actorId: null,
        actorEmail: 'system',
        resourceType: 'user',
        resourceId: root!.id,
        resourceName: ROOT.email,
        result: 'success',
        metadata: expect.objectContaining({ purpose: 'password_reset', via: 'cli' }),
      });
      // token 只存雜湊：稽核與資料庫都沒有原文
      expect(JSON.stringify(audit?.metadata)).not.toContain(tokenOf(result.link));

      await request(http)
        .post('/auth/reset-password')
        .send({ token: tokenOf(result.link), newPassword: NEW_PASSWORD })
        .expect(200);
      await request(http)
        .post('/auth/login')
        .send({ email: ROOT.email, password: NEW_PASSWORD })
        .expect(200);
    });

    it('重新執行會作廢前一個連結', async () => {
      const first = await resetTenant(ROOT.email);
      const second = await resetTenant(ROOT.email);
      await request(http)
        .post('/auth/reset-password')
        .send({ token: tokenOf(first.link), newPassword: NEW_PASSWORD })
        .expect(400);
      await request(http)
        .post('/auth/reset-password')
        .send({ token: tokenOf(second.link), newPassword: NEW_PASSWORD })
        .expect(200);
    });

    it('還沒啟用（pending）的 super-admin → 簽發啟用連結（/setup），走 POST /auth/setup', async () => {
      const id = await createTenantUser('cli-pending@example.com', {
        superAdmin: true,
        status: 'pending',
      });
      const result = await resetTenant('CLI-Pending@example.com');
      expect(result.purpose).toBe('activation');
      expect(new URL(result.link).pathname).toBe('/setup');
      const [token] = await db
        .select()
        .from(authTokens)
        .where(and(eq(authTokens.userId, id), eq(authTokens.purpose, 'activation')));
      expect(token?.usedAt).toBeNull();

      await request(http)
        .post('/auth/setup')
        .send({ token: tokenOf(result.link), password: NEW_PASSWORD })
        .expect(200);
      const [user] = await db.select().from(users).where(eq(users.id, id));
      expect(user?.status).toBe('active');
    });

    it('不是 super-admin、已停用、不存在 → 拒絕，不簽發也不寫稽核', async () => {
      await createTenantUser('cli-member@example.com');
      await createTenantUser('cli-stopped@example.com', { superAdmin: true, status: 'inactive' });
      const audits = async () =>
        (await db.select().from(auditLogs).where(eq(auditLogs.action, SUPER_ADMIN_RESET_ACTION)))
          .length;
      const count = await audits();

      await expect(resetTenant('cli-member@example.com')).rejects.toThrow('super-admin');
      await expect(resetTenant('cli-stopped@example.com')).rejects.toThrow('已停用');
      await expect(resetTenant('nobody@example.com')).rejects.toThrow('沒有');
      await expect(
        resetSuperAdmin({ target: { tenant: 'no-such-tenant' }, email: ROOT.email }),
      ).rejects.toThrow('no-such-tenant');
      expect(await audits()).toBe(count);
    });
  });

  describe('平台的 super-admin（--platform）', () => {
    it('簽出的重設連結走 POST /platform/auth/reset-password 完成重設，並寫平台稽核；連結不帶 tenant', async () => {
      await upsertPlatformAdmin(platformDb, {
        email: 'cli-pa-root@example.com',
        displayName: 'root',
        password: 'Forgotten-Password-2026',
        role: 'super-admin',
      });
      const [admin] = await platformDb
        .select()
        .from(platformAdmins)
        .where(eq(platformAdmins.email, 'cli-pa-root@example.com'));

      const result = await resetSuperAdmin({
        target: 'platform',
        email: 'cli-pa-root@example.com',
        confirm: CONFIRM,
      });
      expect(result.purpose).toBe('password_reset');
      expect(new URL(result.link).searchParams.has('tenant')).toBe(false);

      const [audit] = await platformDb
        .select()
        .from(platformAuditLogs)
        .where(
          and(
            eq(platformAuditLogs.action, SUPER_ADMIN_RESET_ACTION),
            eq(platformAuditLogs.resourceId, admin!.id),
          ),
        );
      expect(audit).toMatchObject({ actorEmail: 'system', resourceType: 'platformAdmin' });

      await request(http)
        .post('/platform/auth/reset-password')
        .set('Host', AUTH_HOST)
        .send({ token: tokenOf(result.link), newPassword: NEW_PASSWORD })
        .expect(200);
    });

    it('不是平台的 super-admin → 拒絕', async () => {
      await upsertPlatformAdmin(platformDb, {
        email: 'cli-pa-operator@example.com',
        displayName: 'operator',
        password: 'Forgotten-Password-2026',
        role: 'operator',
      });
      await expect(
        resetSuperAdmin({
          target: 'platform',
          email: 'cli-pa-operator@example.com',
          confirm: CONFIRM,
        }),
      ).rejects.toThrow('operator');
    });
  });
});
