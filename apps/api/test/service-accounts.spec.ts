import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  apiTokens,
  relationTuples,
  roleHolderTuple,
  rolePermissionTuple,
  roles,
  users,
} from '@/db/schema';
import { parseToken } from '@/modules/api-token/api-token.format';
import { sha256 } from '@/modules/credential/token-hash';
import { PermissionService } from '@/modules/permission/permission.service';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { inTestTenant, testTenantContext } from './tenant';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;
let tenantCode: string;

interface Credentials {
  email: string;
  password: string;
}

const ROOT: Credentials = { email: 'sa-root@example.com', password: 'RootPassword!2026' };
const ADMIN: Credentials = { email: 'sa-admin@example.com', password: 'AdminPassword!2026' };
/** 只能管理服務帳號（含它的 token），本身沒有 `user:read`。 */
const MANAGER: Credentials = { email: 'sa-manager@example.com', password: 'ManagerPassword!2026' };
const MEMBER: Credentials = { email: 'sa-member@example.com', password: 'MemberPassword!2026' };

const ids: Record<string, string> = {};

interface ServiceAccountBody {
  id: string;
  name: string;
  status: string;
  version: number;
  activeTokenCount: number;
  roles: { slug: string }[];
}

interface ApiTokenBody {
  id: string;
  prefix: string;
  status: string;
  scopes: string[] | null;
}

/** 登入端點有速率限制：同一個人沿用同一把 access token（改密碼後清掉）。 */
const sessions = new Map<string, string>();

async function login(credentials: Credentials): Promise<string> {
  const cached = sessions.get(credentials.email);
  if (cached) return cached;
  const response = await request(http).post('/auth/login').send(credentials).expect(200);
  const token = (response.body as { data: { accessToken: string } }).data.accessToken;
  sessions.set(credentials.email, token);
  return token;
}

async function as(credentials: Credentials) {
  const token = await login(credentials);
  const auth = { authorization: `Bearer ${token}` };
  return {
    get: (path: string) => request(http).get(path).set(auth),
    post: (path: string, body?: object) => request(http).post(path).set(auth).send(body),
    patch: (path: string, body: object) => request(http).patch(path).set(auth).send(body),
    put: (path: string, body: object) => request(http).put(path).set(auth).send(body),
    delete: (path: string) => request(http).delete(path).set(auth),
  };
}

async function createActiveUser(credentials: Credentials, roleIds: string[] = []): Promise<string> {
  const { hashPassword } = await import('@/modules/credential/password');
  const [user] = await db
    .insert(users)
    .values({
      email: credentials.email,
      displayName: credentials.email,
      passwordHash: await hashPassword(credentials.password),
      status: 'active',
    })
    .returning();
  if (roleIds.length) {
    await db
      .insert(relationTuples)
      .values(roleIds.map((roleId) => roleHolderTuple(roleId, user!.id)));
  }
  return user!.id;
}

async function createRole(slug: string, keys: string[]): Promise<string> {
  const [role] = await db.insert(roles).values({ slug, name: slug, isSystem: false }).returning();
  await db.insert(relationTuples).values(keys.map((key) => rolePermissionTuple(role!.id, key)));
  return role!.id;
}

async function roleIdOf(slug: string): Promise<string> {
  const [role] = await db.select().from(roles).where(eq(roles.slug, slug));
  return role!.id;
}

function dataOf<T>(response: request.Response): T {
  return (response.body as { data: T }).data;
}

describe('服務帳號與 API token（docs/adr/0027-api-tokens-external-api.md T1）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = ROOT.email;
    process.env.SUPER_ADMIN_PASSWORD = ROOT.password;

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);

    ids.readerRole = await createRole('sa-reader', ['user:read', 'role:read']);
    // admin 沒有 system:update：用來驗證反提權
    ids.settingsRole = await createRole('sa-settings', ['system:update']);
    ids.managerRole = await createRole('sa-manager', ['serviceAccount:update']);
    ids.admin = await createActiveUser(ADMIN, [await roleIdOf('admin')]);
    ids.manager = await createActiveUser(MANAGER, [ids.managerRole]);
    ids.member = await createActiveUser(MEMBER);

    const { AppModule } = await import('@/app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    http = await listenOnLoopback(app);
    tenantCode = (await testTenantContext(app)).code;
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  describe('服務帳號（D1）', () => {
    it('建立：是 users 的一列（kind = service），沒有密碼、email 不可投遞', async () => {
      const admin = await as(ADMIN);
      const response = await admin
        .post('/service-accounts', { name: 'CI 建置', roleIds: [ids.readerRole] })
        .expect(201);
      const account = dataOf<ServiceAccountBody>(response);
      ids.ci = account.id;
      expect(account).toMatchObject({ name: 'CI 建置', status: 'active', activeTokenCount: 0 });
      expect(account.roles.map((role) => role.slug)).toEqual(['sa-reader']);

      const [row] = await db.select().from(users).where(eq(users.id, account.id));
      expect(row).toMatchObject({ kind: 'service', passwordHash: null });
      expect(row!.email).toBe(`svc-${account.id}@service.invalid`);
    });

    it('使用者列表、使用者詳情都看不到服務帳號；服務帳號列表看得到', async () => {
      const admin = await as(ADMIN);
      const listed = dataOf<{ items: { id: string }[] }>(await admin.get('/users?limit=100'));
      expect(listed.items.map((user) => user.id)).not.toContain(ids.ci);
      expect((await admin.get(`/users/${ids.ci}`)).body).toMatchObject({
        error: { code: 'USER_NOT_FOUND' },
      });

      const accounts = dataOf<{ items: { id: string }[] }>(await admin.get('/service-accounts'));
      expect(accounts.items.map((account) => account.id)).toEqual([ids.ci]);
    });

    it('指派的角色受反提權限制：admin 不能給自己沒有的權限、不能給 super-admin', async () => {
      const admin = await as(ADMIN);
      await admin.post('/service-accounts', { name: 'x', roleIds: [ids.settingsRole] }).expect(403);
      const response = await admin
        .post('/service-accounts', { name: 'x', roleIds: [await roleIdOf('super-admin')] })
        .expect(403);
      expect(response.body).toMatchObject({
        error: { code: 'AUTHZ_ESCALATION', details: { role: 'super-admin' } },
      });
    });

    it('持有 super-admin 的服務帳號不算「最後一位 super-admin」（I8 只看人）', async () => {
      const root = await as(ROOT);
      const created = await root
        .post('/service-accounts', { name: '全權', roleIds: [await roleIdOf('super-admin')] })
        .expect(201);
      ids.superAccount = dataOf<ServiceAccountBody>(created).id;

      const { UserRepository } = await import('@/modules/user/user.repository');
      const count = await inTestTenant(app, () =>
        app.get(UserRepository, { strict: false }).countActiveUsersByRoleSlug('super-admin'),
      );
      expect(count).toBe(1);
    });

    it('持有 super-admin 的服務帳號只有 super-admin 能管理', async () => {
      const admin = await as(ADMIN);
      await admin
        .post(`/service-accounts/${ids.superAccount}/tokens`, { name: 't', expiresInDays: 30 })
        .expect(403);
      await admin.delete(`/service-accounts/${ids.superAccount}`).expect(403);
    });

    it('審批的待審通知只給人：持有 approval:review 的服務帳號不在收件人裡', async () => {
      const recipients = await inTestTenant(app, () =>
        app.get(PermissionService).findActiveUserIdsWithPermission('approval:review'),
      );
      expect(recipients).toContain(ids.admin);
      expect(recipients).not.toContain(ids.superAccount);
    });
  });

  describe('服務帳號的 token（D2、D4、D7）', () => {
    it('建立：回應帶完整 token 一次；資料庫只存 secret 的 SHA-256', async () => {
      const admin = await as(ADMIN);
      const response = await admin
        .post(`/service-accounts/${ids.ci}/tokens`, { name: '建置機', expiresInDays: 30 })
        .expect(201);
      const { token, apiToken } = dataOf<{ token: string; apiToken: ApiTokenBody }>(response);
      ids.ciToken = apiToken.id;

      const parsed = parseToken(token);
      expect(parsed).toMatchObject({ tenantCode, tokenId: apiToken.id });
      expect(token.startsWith(apiToken.prefix)).toBe(true);
      expect(apiToken).toMatchObject({ status: 'active', scopes: null });

      const [row] = await db.select().from(apiTokens).where(eq(apiTokens.id, apiToken.id));
      expect(row!.secretHash).toBe(sha256(parsed!.secret));
    });

    it('列表不含 secret', async () => {
      const admin = await as(ADMIN);
      const response = await admin.get(`/service-accounts/${ids.ci}/tokens`).expect(200);
      const { items } = dataOf<{ items: ApiTokenBody[] }>(response);
      expect(items.map((item) => item.id)).toEqual([ids.ciToken]);
      expect(JSON.stringify(response.body)).not.toMatch(
        /b2bt_[^"]*_[0-9A-Za-z]{22}_[0-9A-Za-z]{20,}/,
      );
      const account = dataOf<ServiceAccountBody>(await admin.get(`/service-accounts/${ids.ci}`));
      expect(account.activeTokenCount).toBe(1);
    });

    it('反提權：token 取得的有效權限要是操作者持有的；scope 限縮到持有的範圍內就可以', async () => {
      const manager = await as(MANAGER);
      // 帳號有 user:read，manager 沒有
      const denied = await manager
        .post(`/service-accounts/${ids.ci}/tokens`, { name: 't', expiresInDays: 30 })
        .expect(403);
      expect(denied.body).toMatchObject({
        error: { code: 'AUTHZ_ESCALATION', details: { missing: ['user:read'] } },
      });
      // role:read 是 manager 經依賴樹持有的
      await manager
        .post(`/service-accounts/${ids.ci}/tokens`, {
          name: 'roles only',
          expiresInDays: 30,
          scopes: ['role:read'],
        })
        .expect(201);
    });

    it('到期上限：服務帳號 365 天（DTO），個人 90 天（設定）', async () => {
      const admin = await as(ADMIN);
      await admin
        .post(`/service-accounts/${ids.ci}/tokens`, { name: 't', expiresInDays: 366 })
        .expect(400);
      const member = await as(MEMBER);
      const response = await member
        .post('/auth/api-tokens', { name: 't', expiresInDays: 91 })
        .expect(400);
      expect(response.body).toMatchObject({
        error: { code: 'API_TOKEN_LIFETIME_EXCEEDED', details: { maxDays: 90 } },
      });
    });

    it('撤銷；已撤銷的再撤銷一次是 404', async () => {
      const admin = await as(ADMIN);
      const created = await admin
        .post(`/service-accounts/${ids.ci}/tokens`, { name: 'temp', expiresInDays: 1 })
        .expect(201);
      const tokenId = dataOf<{ apiToken: ApiTokenBody }>(created).apiToken.id;
      await admin.delete(`/service-accounts/${ids.ci}/tokens/${tokenId}`).expect(204);
      const again = await admin.delete(`/service-accounts/${ids.ci}/tokens/${tokenId}`).expect(404);
      expect(again.body).toMatchObject({ error: { code: 'API_TOKEN_NOT_FOUND' } });
    });

    it('停用帳號：它的 token 全部失效（token_version 變了），再啟用也不會回來（D5）', async () => {
      const admin = await as(ADMIN);
      const current = dataOf<ServiceAccountBody>(await admin.get(`/service-accounts/${ids.ci}`));
      const disabled = await admin
        .patch(`/service-accounts/${ids.ci}`, { status: 'inactive', version: current.version })
        .expect(200);
      expect(dataOf<ServiceAccountBody>(disabled)).toMatchObject({
        status: 'inactive',
        activeTokenCount: 0,
      });
      await admin
        .patch(`/service-accounts/${ids.ci}`, {
          status: 'active',
          version: dataOf<ServiceAccountBody>(disabled).version,
        })
        .expect(200);
      const { items } = dataOf<{ items: ApiTokenBody[] }>(
        await admin.get(`/service-accounts/${ids.ci}/tokens`),
      );
      expect(items.find((item) => item.id === ids.ciToken)?.status).toBe('invalidated');
    });

    it('樂觀鎖：舊的 version 回 409', async () => {
      const admin = await as(ADMIN);
      const response = await admin
        .patch(`/service-accounts/${ids.ci}`, { name: 'stale', version: 1 })
        .expect(409);
      expect(response.body).toMatchObject({ error: { code: 'SERVICE_ACCOUNT_VERSION_CONFLICT' } });
    });

    it('刪除：token 標成撤銷；不進回收桶', async () => {
      const admin = await as(ADMIN);
      await admin.delete(`/service-accounts/${ids.ci}`).expect(204);
      await admin.get(`/service-accounts/${ids.ci}`).expect(404);
      const rows = await db.select().from(apiTokens).where(eq(apiTokens.userId, ids.ci!));
      expect(rows.every((row) => row.revokedAt !== null)).toBe(true);
      const trash = dataOf<{ items: { id: string }[] }>(await admin.get('/trash?type=user'));
      expect(trash.items.map((item) => item.id)).not.toContain(ids.ci);
    });
  });

  describe('個人 token（D2、D5、D14）', () => {
    it('本人建立、列出、撤銷', async () => {
      const member = await as(MEMBER);
      const created = await member
        .post('/auth/api-tokens', { name: '我的腳本', expiresInDays: 30 })
        .expect(201);
      const { token, apiToken } = dataOf<{ token: string; apiToken: ApiTokenBody }>(created);
      ids.memberToken = apiToken.id;
      expect(parseToken(token)?.tenantCode).toBe(tenantCode);

      const listed = dataOf<{ items: ApiTokenBody[] }>(await member.get('/auth/api-tokens'));
      expect(listed.items.map((item) => item.id)).toEqual([apiToken.id]);
    });

    it('別人的 token 不能用個人端點撤銷', async () => {
      const admin = await as(ADMIN);
      await admin.delete(`/auth/api-tokens/${ids.memberToken}`).expect(404);
    });

    it('管理者以 user:update 檢視、撤銷別人的個人 token；manager 沒有 user:update', async () => {
      const manager = await as(MANAGER);
      await manager.get(`/users/${ids.member}/api-tokens`).expect(403);

      const admin = await as(ADMIN);
      const listed = dataOf<{ items: ApiTokenBody[] }>(
        await admin.get(`/users/${ids.member}/api-tokens`).expect(200),
      );
      expect(listed.items.map((item) => item.id)).toEqual([ids.memberToken]);
      await admin.delete(`/users/${ids.member}/api-tokens/${ids.memberToken}`).expect(204);

      const member = await as(MEMBER);
      const [item] = dataOf<{ items: ApiTokenBody[] }>(await member.get('/auth/api-tokens')).items;
      expect(item?.status).toBe('revoked');
    });

    it('服務帳號的 id 不能拿來當使用者查 token', async () => {
      const admin = await as(ADMIN);
      const response = await admin.get(`/users/${ids.superAccount}/api-tokens`).expect(404);
      expect(response.body).toMatchObject({ error: { code: 'USER_NOT_FOUND' } });
    });

    it('改密碼後，個人 token 失效（token_version 變了）', async () => {
      const member = await as(MEMBER);
      await member.post('/auth/api-tokens', { name: '改密碼前', expiresInDays: 30 }).expect(201);
      await member
        .post('/auth/change-password', {
          currentPassword: MEMBER.password,
          newPassword: 'Kestrel-Orbit-Lantern!58',
        })
        .expect(200);
      MEMBER.password = 'Kestrel-Orbit-Lantern!58';
      sessions.delete(MEMBER.email);

      const after = await as(MEMBER);
      const { items } = dataOf<{ items: (ApiTokenBody & { name: string })[] }>(
        await after.get('/auth/api-tokens'),
      );
      expect(items.find((item) => item.name === '改密碼前')?.status).toBe('invalidated');
    });
  });
});
