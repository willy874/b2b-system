import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  auditLogs,
  relationTuples,
  roleHolderTuple,
  roles,
  systemSettings,
  users,
} from '@/db/schema';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;

const SUPER_ADMIN = { email: 'root@example.com', password: 'Quiet-Harbor-Lantern-26' };
const ADMIN = { email: 'settings-admin@example.com', password: 'AdminPassword!2026' };
const VICTIM = { email: 'settings-victim@example.com', password: 'VictimPassword!2026' };

/** 登入端點有速率限制：同一個人的 token 跨測試重用。 */
const tokenCache = new Map<string, string>();

async function login(credentials: { email: string; password: string }): Promise<string> {
  const cached = tokenCache.get(credentials.email);
  if (cached) return cached;
  const response = await request(http).post('/auth/login').send(credentials).expect(200);
  const token = (response.body as { data: { accessToken: string } }).data.accessToken;
  tokenCache.set(credentials.email, token);
  return token;
}

async function createActiveUser(email: string, password: string, roleSlug?: string) {
  const { hashPassword } = await import('@/modules/credential/password');
  const [user] = await db
    .insert(users)
    .values({
      email,
      displayName: email,
      passwordHash: await hashPassword(password),
      status: 'active',
    })
    .returning();
  if (roleSlug) {
    const [role] = await db.select().from(roles).where(eq(roles.slug, roleSlug));
    await db.insert(relationTuples).values(roleHolderTuple(role!.id, user!.id));
  }
}

/** 以 super-admin 送出修改並斷言狀態碼。 */
async function patchSettings(values: Record<string, unknown>, status: number) {
  const token = await login(SUPER_ADMIN);
  return request(http)
    .patch('/system/settings')
    .set('authorization', `Bearer ${token}`)
    .send({ values })
    .expect(status);
}

interface SettingItem {
  key: string;
  value: unknown;
  defaultValue: unknown;
  isOverridden: boolean;
  minimum: number | null;
  maximum: number | null;
}

function itemOf(body: unknown, key: string): SettingItem | undefined {
  return (body as { data: { items: SettingItem[] } }).data.items.find((item) => item.key === key);
}

describe('系統設定（docs/architecture/backend/12-settings.md）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN.email;
    process.env.SUPER_ADMIN_PASSWORD = SUPER_ADMIN.password;

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);

    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);
    await createActiveUser(ADMIN.email, ADMIN.password, 'admin');
    await createActiveUser(VICTIM.email, VICTIM.password);

    const { AppModule } = await import('@/app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    http = await listenOnLoopback(app);
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('列表：沒有覆寫時是預設值，並帶出允許範圍', async () => {
    const response = await request(http)
      .get('/system/settings')
      .set('authorization', `Bearer ${await login(ADMIN)}`)
      .expect(200);
    expect(itemOf(response.body, 'auth.loginMaxAttempts')).toMatchObject({
      value: 5,
      defaultValue: 5,
      isOverridden: false,
      minimum: 3,
      maximum: 20,
    });
  });

  it('只有 system:read 的人不能修改 → 403', async () => {
    await request(http)
      .patch('/system/settings')
      .set('authorization', `Bearer ${await login(ADMIN)}`)
      .send({ values: { 'auth.loginMaxAttempts': 4 } })
      .expect(403);
  });

  it('超出範圍 → 400 VALIDATION_FAILED，依 key 指出欄位，什麼都不寫', async () => {
    const response = await patchSettings({ 'auth.loginMaxAttempts': 0 }, 400);
    expect(response.body).toMatchObject({
      error: {
        code: 'VALIDATION_FAILED',
        details: { fields: { 'values.auth.loginMaxAttempts': expect.any(String) } },
      },
    });
    expect(await db.select().from(systemSettings)).toHaveLength(0);
  });

  it('沒有登記的 key → 404 SETTING_NOT_FOUND', async () => {
    const response = await patchSettings({ 'auth.nope': 1 }, 404);
    expect(response.body).toMatchObject({
      error: { code: 'SETTING_NOT_FOUND', details: { key: 'auth.nope' } },
    });
  });

  it('修改寫入覆寫值與一筆稽核（前後差異）；值為 null 還原預設', async () => {
    const updated = await patchSettings({ 'auth.loginLockoutSeconds': 120 }, 200);
    expect(itemOf(updated.body, 'auth.loginLockoutSeconds')).toMatchObject({
      value: 120,
      isOverridden: true,
    });

    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, 'setting.update'));
    expect(audit).toMatchObject({
      resourceType: 'setting',
      changes: {
        before: { 'auth.loginLockoutSeconds': 900 },
        after: { 'auth.loginLockoutSeconds': 120 },
      },
    });

    const reset = await patchSettings({ 'auth.loginLockoutSeconds': null }, 200);
    expect(itemOf(reset.body, 'auth.loginLockoutSeconds')).toMatchObject({
      value: 900,
      isOverridden: false,
    });
    expect(await db.select().from(systemSettings)).toHaveLength(0);
  });

  it('公開設定不需登入，只包含標為公開的 key', async () => {
    const response = await request(http).get('/system/settings/public').expect(200);
    const values = (response.body as { data: { values: Record<string, unknown> } }).data.values;
    expect(values).toMatchObject({
      'auth.registrationEnabled': true,
      'auth.passwordMinLength': 12,
      'general.defaultTimezone': 'Asia/Taipei',
    });
    expect(values).not.toHaveProperty('auth.loginMaxAttempts');
  });

  it('關閉註冊 → POST /auth/register 回 404 AUTH_REGISTRATION_DISABLED', async () => {
    await patchSettings({ 'auth.registrationEnabled': false }, 200);
    const response = await request(http)
      .post('/auth/register')
      .send({ email: 'newbie@example.com', displayName: 'Newbie' })
      .expect(404);
    expect(response.body).toMatchObject({ error: { code: 'AUTH_REGISTRATION_DISABLED' } });
    await patchSettings({ 'auth.registrationEnabled': null }, 200);
  });

  it('調高密碼最短長度 → 較短的密碼被擋，錯誤形狀與 DTO 驗證相同', async () => {
    await patchSettings({ 'auth.passwordMinLength': 20 }, 200);
    const response = await request(http)
      .post('/auth/change-password')
      .set('authorization', `Bearer ${await login(ADMIN)}`)
      .send({ currentPassword: ADMIN.password, newPassword: 'ShortPassword!26' })
      .expect(400);
    expect(response.body).toMatchObject({
      error: {
        code: 'VALIDATION_FAILED',
        details: { fields: { newPassword: 'AUTH_PASSWORD_WEAK' }, minLength: 20 },
      },
    });
    await patchSettings({ 'auth.passwordMinLength': null }, 200);
  });

  it('登入失敗鎖定次數依租戶的設定', async () => {
    await patchSettings({ 'auth.loginMaxAttempts': 3 }, 200);
    const wrong = { email: VICTIM.email, password: 'WrongPassword!2026' };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await request(http).post('/auth/login').send(wrong).expect(401);
    }
    const [victim] = await db.select().from(users).where(eq(users.email, VICTIM.email));
    // 自動鎖定只寫 locked_until、不改 status（docs/architecture/backend/04-auth.md §3.3）
    expect(victim).toMatchObject({ status: 'active', failedLoginCount: 3 });
    expect(victim!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });
});
