import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { apiTokens, relationTuples, roleHolderTuple, roles, users } from '@/db/schema';
import { ApiTokenUsageService } from '@/modules/api-token/api-token-usage.service';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';

/**
 * 對外 API（docs/adr/0027-api-tokens-external-api.md T2）：同一個測試程序裡起兩個 app——內部 api（AppModule）
 * 與對外 API（ExternalApiModule），共用一個 Postgres。token 在內部 api 建立與撤銷，在對外 API 使用。
 */

let internal: INestApplication;
let external: INestApplication;
let internalHttp: App;
let externalHttp: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;

const ROOT = { email: 'ext-root@example.com', password: 'RootPassword!2026' };
const ADMIN = { email: 'ext-admin@example.com', password: 'AdminPassword!2026' };
/** 認證失敗的上限調小，最後一個測試才測得到 429（前面的測試也會用掉幾次）。 */
const AUTH_FAILURE_LIMIT = 25;

const ids: Record<string, string> = {};
let adminToken: string;

interface CreatedToken {
  token: string;
  apiToken: { id: string };
}

async function login(credentials: { email: string; password: string }): Promise<string> {
  const response = await request(internalHttp).post('/auth/login').send(credentials).expect(200);
  return (response.body as { data: { accessToken: string } }).data.accessToken;
}

/** 以 admin 身分在內部 api 打。 */
function asAdmin() {
  const auth = { authorization: `Bearer ${adminToken}` };
  return {
    get: (path: string) => request(internalHttp).get(path).set(auth),
    post: (path: string, body?: object) => request(internalHttp).post(path).set(auth).send(body),
    patch: (path: string, body: object) => request(internalHttp).patch(path).set(auth).send(body),
    delete: (path: string) => request(internalHttp).delete(path).set(auth),
  };
}

/** 以 API token 打對外 API。 */
function ext(token?: string) {
  const req = (method: 'get' | 'post', path: string) => {
    const pending = request(externalHttp)[method](path);
    return token ? pending.set('authorization', `Bearer ${token}`) : pending;
  };
  return { get: (path: string) => req('get', path) };
}

async function createToken(
  serviceAccountId: string,
  body: Record<string, unknown> = {},
): Promise<CreatedToken> {
  const response = await asAdmin()
    .post(`/service-accounts/${serviceAccountId}/tokens`, {
      name: 'ci',
      expiresInDays: 30,
      ...body,
    })
    .expect(201);
  return (response.body as { data: CreatedToken }).data;
}

function errorCode(response: request.Response): string | undefined {
  return (response.body as { error?: { code?: string } }).error?.code;
}

describe('對外 API（docs/adr/0027-api-tokens-external-api.md D9～D17）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = ROOT.email;
    process.env.SUPER_ADMIN_PASSWORD = ROOT.password;
    process.env.EXTERNAL_AUTH_FAILURE_RATE_LIMIT = String(AUTH_FAILURE_LIMIT);

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);

    const { hashPassword } = await import('@/modules/credential/password');
    const [admin] = await db
      .insert(users)
      .values({
        email: ADMIN.email,
        displayName: 'Admin',
        passwordHash: await hashPassword(ADMIN.password),
        status: 'active',
      })
      .returning();
    const [adminRole] = await db.select().from(roles).where(eq(roles.slug, 'admin'));
    await db.insert(relationTuples).values(roleHolderTuple(adminRole!.id, admin!.id));
    const [auditorRole] = await db.select().from(roles).where(eq(roles.slug, 'auditor'));
    ids.auditorRole = auditorRole!.id;

    const { AppModule } = await import('@/app.module');
    internal = await NestFactory.create(AppModule, { logger: false });
    internalHttp = await listenOnLoopback(internal);
    const { ExternalApiModule } = await import('@/external-api.module');
    external = await NestFactory.create(ExternalApiModule, { logger: false });
    externalHttp = await listenOnLoopback(external);

    adminToken = await login(ADMIN);
    const account = await asAdmin()
      .post('/service-accounts', { name: '報表同步', roleIds: [ids.auditorRole] })
      .expect(201);
    ids.account = (account.body as { data: { id: string } }).data.id;
  });

  afterAll(async () => {
    await external?.close();
    await internal?.close();
    await closeDb?.();
  });

  describe('認證：只認 API token（D10）', () => {
    it('GET /v1/me：帳號、token 與實際取得的權限', async () => {
      const { token, apiToken } = await createToken(ids.account!);
      ids.token = apiToken.id;
      ids.raw = token;
      const response = await ext(token).get('/v1/me').expect(200);
      const me = (
        response.body as {
          data: {
            account: { id: string; kind: string; email: string | null };
            token: { id: string; scopes: string[] | null };
            permissions: string[];
          };
        }
      ).data;
      expect(me.account).toMatchObject({ id: ids.account, kind: 'service', email: null });
      expect(me.token).toMatchObject({ id: apiToken.id, scopes: null });
      // auditor 的權限（含依賴樹）
      expect(me.permissions).toEqual(expect.arrayContaining(['user:read', 'auditLog:read']));
      expect(me.permissions).not.toContain('user:update');
    });

    it('沒帶 token、格式不對、secret 被改過、租戶代碼被換掉 → 401', async () => {
      const raw = ids.raw!;
      const tampered = `${raw.slice(0, -1)}${raw.endsWith('a') ? 'b' : 'a'}`;
      const otherTenant = raw.replace(/^b2bt_[a-z0-9-]+_/, 'b2bt_other-tenant_');
      for (const token of [undefined, 'not-a-token', tampered, otherTenant]) {
        // oxlint-disable-next-line no-await-in-loop -- 依序送出，每一個都要 401
        const response = await ext(token).get('/v1/me');
        expect(response.status).toBe(401);
        expect(errorCode(response)).toBe('AUTH_TOKEN_INVALID');
      }
    });

    it('JWT access token 在對外 API 無效；API token 在內部 api 無效', async () => {
      const jwt = await ext(adminToken).get('/v1/me').expect(401);
      expect(errorCode(jwt)).toBe('AUTH_TOKEN_INVALID');
      const token = await request(internalHttp)
        .get('/users')
        .set('authorization', `Bearer ${ids.raw}`)
        .expect(401);
      expect(errorCode(token)).toBe('AUTH_TOKEN_INVALID');
    });
  });

  describe('入口的分界（D11）', () => {
    it('對外 API 上的內部路由回 404，即使帶了有效的 token（SurfaceGuard，不是路由不存在）', async () => {
      // ApiTokenModule 在兩個程序都註冊了 /auth/api-tokens：對外 API 上由 SurfaceGuard 擋下
      const response = await ext(ids.raw).get('/auth/api-tokens').expect(404);
      expect(response.body).toMatchObject({ error: { code: 'NOT_FOUND', message: 'NOT_FOUND' } });
    });

    it('內部 api 上的 /v1/* 回 404', async () => {
      await asAdmin().get('/v1/me').expect(404);
    });

    it('健康檢查兩邊都有', async () => {
      await ext().get('/health').expect(200);
      await request(internalHttp).get('/health').expect(200);
    });
  });

  describe('權限：帳號的權限 ∩ scopes（D3）', () => {
    it('限縮到 role:read 的 token 只有 role:read', async () => {
      const { token } = await createToken(ids.account!, { scopes: ['role:read'] });
      const response = await ext(token).get('/v1/me').expect(200);
      expect((response.body as { data: { permissions: string[] } }).data.permissions).toEqual([
        'role:read',
      ]);
    });
  });

  describe('失效（D5、D17）', () => {
    it('在內部 api 撤銷：對外 API 不等快取的 10 秒就拒絕', async () => {
      const { token, apiToken } = await createToken(ids.account!);
      await ext(token).get('/v1/me').expect(200);
      await asAdmin().delete(`/service-accounts/${ids.account}/tokens/${apiToken.id}`).expect(204);
      await vi.waitFor(async () => expect((await ext(token).get('/v1/me')).status).toBe(401), {
        timeout: 2_000,
      });
    });

    it('過期 → 401 AUTH_API_TOKEN_EXPIRED', async () => {
      const { token, apiToken } = await createToken(ids.account!);
      await db
        .update(apiTokens)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(apiTokens.id, apiToken.id));
      const response = await ext(token).get('/v1/me').expect(401);
      expect(errorCode(response)).toBe('AUTH_API_TOKEN_EXPIRED');
    });

    it('記下最後使用時間（每分鐘批次寫入）', async () => {
      await ext(ids.raw).get('/v1/me').expect(200);
      await external.get(ApiTokenUsageService).flush();
      const [row] = await db.select().from(apiTokens).where(eq(apiTokens.id, ids.token!));
      expect(row!.lastUsedAt).not.toBeNull();
    });

    it('在內部 api 停用帳號：它的 token 在對外 API 立即失效', async () => {
      const current = await asAdmin().get(`/service-accounts/${ids.account}`).expect(200);
      const { version } = (current.body as { data: { version: number } }).data;
      await asAdmin()
        .patch(`/service-accounts/${ids.account}`, { status: 'inactive', version })
        .expect(200);
      await vi.waitFor(
        async () => {
          const response = await ext(ids.raw).get('/v1/me');
          expect(response.status).not.toBe(200);
        },
        { timeout: 2_000 },
      );
    });
  });

  describe('速率限制（D13）', () => {
    it('同一個 IP 驗證失敗太多次 → 429，帶 Retry-After', async () => {
      let response: request.Response | undefined;
      for (let attempt = 0; attempt <= AUTH_FAILURE_LIMIT; attempt += 1) {
        // oxlint-disable-next-line no-await-in-loop -- 依序送出直到被擋
        response = await ext('b2bt_x_y_z').get('/v1/me');
        if (response.status === 429) break;
      }
      expect(response?.status).toBe(429);
      expect(response?.headers['retry-after']).toBeDefined();
    });
  });
});
