import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { and, eq, isNull, sql } from 'drizzle-orm';
import request from 'supertest';
import type { Response } from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  auditLogs,
  authTokens,
  groupMemberTuple,
  groupRoleTuple,
  groups,
  isRoleHolderTuple,
  relationTuples,
  roleHolderTuple,
  rolePermissionTuple,
  roles,
  userLoginSources,
  users,
} from '@/db/schema';
import { AuthTokenService } from '@/modules/credential/auth-token.service';
import { hashPassword } from '@/modules/credential/password';

import { heldRoleIds } from './authz';
import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { clearLoginDelay } from './login-throttle';
import { inTestTenant } from './tenant';
import { currentRoleIds, userVersion } from './versions';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;

const ROOT = { email: 'sec-root@example.com', password: 'Quiet-Harbor-Lantern-26' };
const ROOT_2 = { email: 'sec-root2@example.com', password: 'SecondRootPassword!2026' };
const ADMIN = { email: 'sec-admin@example.com', password: 'AdminPassword!2026' };
/** 租戶的預設鎖定門檻（系統設定 auth.loginMaxAttempts）。 */
const MAX_ATTEMPTS = 5;

function errorCode(response: Response): string | undefined {
  return (response.body as { error?: { code?: string } }).error?.code;
}

async function roleIdOf(slug: string): Promise<string> {
  const [role] = await db.select().from(roles).where(eq(roles.slug, slug));
  return role!.id;
}

async function createUser(
  email: string,
  password: string | null,
  options: { roleSlug?: string; status?: 'pending' | 'active' | 'inactive' } = {},
): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({
      email,
      displayName: email,
      passwordHash: password ? await hashPassword(password) : null,
      status: options.status ?? 'active',
    })
    .returning();
  if (options.roleSlug) {
    await db
      .insert(relationTuples)
      .values(roleHolderTuple(await roleIdOf(options.roleSlug), user!.id));
  }
  return user!.id;
}

async function userOf(email: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email));
  return user!;
}

/** 密碼正確、但不能登入時留下的稽核（auth.login.failure ＋ credentialsValid）。 */
async function rejectedLoginsOf(userId: string) {
  const rows = await db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, 'auth.login.failure'), eq(auditLogs.resourceId, userId)));
  return rows.filter(
    (row) => (row.metadata as { credentialsValid?: boolean } | null)?.credentialsValid,
  );
}

function login(credentials: { email: string; password: string }) {
  return request(http).post('/auth/login').send(credentials);
}

async function tokenOf(credentials: { email: string; password: string }): Promise<string> {
  const response = await login(credentials).expect(200);
  return (response.body as { data: { accessToken: string } }).data.accessToken;
}

/** 忘掉這個人登入成功過的來源：之後的錯誤密碼才會累計鎖定（docs/architecture/backend/04-auth.md §3.4）。 */
async function forgetLoginSources(email: string): Promise<void> {
  const user = await userOf(email);
  await db.delete(userLoginSources).where(eq(userLoginSources.userId, user.id));
}

/** 管理者把停用的人改回 active。 */
async function reactivate(token: string, id: string) {
  return request(http)
    .patch(`/users/${id}`)
    .set('authorization', `Bearer ${token}`)
    .send({ status: 'active', version: await userVersion(db, id) });
}

/** 啟用／重設信裡的 token（寄信工作在寄出當下才簽發；這裡直接簽一張）。 */
function issueToken(userId: string, purpose: 'activation' | 'password_reset'): Promise<string> {
  return inTestTenant(
    app,
    async () => (await app.get(AuthTokenService).issue(userId, purpose)).raw,
  );
}

describe('帳號安全', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = ROOT.email;
    process.env.SUPER_ADMIN_PASSWORD = ROOT.password;
    // 這裡會連續送出大量登入請求；限流不是這個檔案要測的
    process.env.AUTH_RATE_LIMIT = '1000';

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);
    await createUser(ADMIN.email, ADMIN.password, { roleSlug: 'admin' });

    const { AppModule } = await import('@/app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    http = await listenOnLoopback(app);
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    delete process.env.AUTH_RATE_LIMIT;
  });

  describe('登入鎖定（docs/architecture/backend/04-auth.md §3.3）', () => {
    const VICTIM = { email: 'victim@example.com', password: 'VictimPassword!2026' };
    const wrong = { email: VICTIM.email, password: 'WrongPassword!2026' };

    beforeAll(async () => {
      await createUser(VICTIM.email, VICTIM.password, { roleSlug: 'member' });
    });

    it('從陌生來源錯滿上限次數後鎖定：status 不變、只寫 locked_until；列表顯示為 locked', async () => {
      const token = await tokenOf(VICTIM);
      await forgetLoginSources(VICTIM.email);
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        // oxlint-disable-next-line no-await-in-loop -- 依序送出才有確定的次數
        expect(errorCode(await login(wrong).expect(401))).toBe('AUTH_INVALID_CREDENTIALS');
        // oxlint-disable-next-line no-await-in-loop -- 第 3 次之後的嘗試會先被漸進延遲擋下
        await clearLoginDelay(app, VICTIM.email);
      }
      const victim = await userOf(VICTIM.email);
      expect(victim.status).toBe('active');
      expect(victim.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
      expect(victim.failedLoginCount).toBe(MAX_ATTEMPTS);

      const admin = await tokenOf(ADMIN);
      const detail = await request(http)
        .get(`/users/${victim.id}`)
        .set('authorization', `Bearer ${admin}`)
        .expect(200);
      expect((detail.body as { data: { status: string } }).data.status).toBe('locked');

      // 鎖定不踢掉已登入的 session：鎖定是擋猜密碼，不能被拿來把人踢下線
      await request(http).get('/auth/profile').set('authorization', `Bearer ${token}`).expect(200);
    });

    it('鎖定中：錯的密碼一律 AUTH_INVALID_CREDENTIALS（不透露鎖定），也不延長鎖定', async () => {
      const before = await userOf(VICTIM.email);
      expect(errorCode(await login(wrong).expect(401))).toBe('AUTH_INVALID_CREDENTIALS');
      const after = await userOf(VICTIM.email);
      expect(after.lockedUntil).toEqual(before.lockedUntil);
      expect(after.failedLoginCount).toBe(before.failedLoginCount);
    });

    it('鎖定中：正確的密碼也回 AUTH_INVALID_CREDENTIALS（不透露猜中了），並留一筆失敗的稽核', async () => {
      const victim = await userOf(VICTIM.email);
      const response = await login(VICTIM).expect(401);
      expect(errorCode(response)).toBe('AUTH_INVALID_CREDENTIALS');
      expect(await rejectedLoginsOf(victim.id)).toEqual([
        expect.objectContaining({
          errorCode: 'AUTH_INVALID_CREDENTIALS',
          metadata: expect.objectContaining({ reason: 'locked', credentialsValid: true }),
        }),
      ]);
    });

    it('鎖定到期後自動解除：正確密碼可以登入，計數與到期時間歸零', async () => {
      await db
        .update(users)
        .set({ lockedUntil: new Date(Date.now() - 1000) })
        .where(eq(users.email, VICTIM.email));
      await login(VICTIM).expect(200);
      const victim = await userOf(VICTIM.email);
      expect(victim).toMatchObject({ status: 'active', failedLoginCount: 0, lockedUntil: null });
    });

    it('鎖定到期後再錯一次不會立刻重鎖（從 1 重新計算）', async () => {
      await forgetLoginSources(VICTIM.email);
      await db
        .update(users)
        .set({ failedLoginCount: MAX_ATTEMPTS, lockedUntil: new Date(Date.now() - 1000) })
        .where(eq(users.email, VICTIM.email));
      await login(wrong).expect(401);
      await clearLoginDelay(app, VICTIM.email);
      const victim = await userOf(VICTIM.email);
      expect(victim.failedLoginCount).toBe(1);
      expect(victim.lockedUntil).toBeNull();
      await login(VICTIM).expect(200);
    });

    it('併發的錯誤密碼每一次都算數：同時送出上限次數就鎖定', async () => {
      const racer = { email: 'racer@example.com', password: 'RacerPassword!2026' };
      await createUser(racer.email, racer.password);
      const responses = await Promise.all(
        Array.from({ length: MAX_ATTEMPTS }, () =>
          login({ email: racer.email, password: 'WrongPassword!2026' }),
        ),
      );
      expect(responses.every((response) => response.status === 401)).toBe(true);
      const row = await userOf(racer.email);
      expect(row.failedLoginCount).toBe(MAX_ATTEMPTS);
      expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    });

    it('鎖定中的人可以用「忘記密碼」寄出的重設連結解鎖', async () => {
      await db
        .update(users)
        .set({ failedLoginCount: MAX_ATTEMPTS, lockedUntil: new Date(Date.now() + 60_000) })
        .where(eq(users.email, VICTIM.email));
      await request(http).post('/auth/forgot-password').send({ email: VICTIM.email }).expect(200);
      const victim = await userOf(VICTIM.email);
      const raw = await issueToken(victim.id, 'password_reset');
      await request(http)
        .post('/auth/reset-password')
        .send({ token: raw, newPassword: 'FreshStartPassword!2026' })
        .expect(200);
      await login({ email: VICTIM.email, password: 'FreshStartPassword!2026' }).expect(200);
    });
  });

  describe('漸進延遲與已知來源（docs/architecture/backend/04-auth.md §3.4）', () => {
    it('連續 3 次錯誤後，下一次嘗試（密碼正確也一樣）回 429 RATE_LIMITED 與 Retry-After；不累計失敗次數', async () => {
      const slow = { email: 'slow@example.com', password: 'SlowPassword!2026' };
      await createUser(slow.email, slow.password);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        // oxlint-disable-next-line no-await-in-loop -- 依序送出才有確定的次數
        await login({ email: slow.email, password: 'WrongPassword!2026' }).expect(401);
      }
      const blocked = await login(slow).expect(429);
      expect(errorCode(blocked)).toBe('RATE_LIMITED');
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      // 被延遲擋下的嘗試不經過帳密檢查：不計入鎖定
      expect((await userOf(slow.email)).failedLoginCount).toBe(3);

      // 不存在的 email 一樣被延遲（不透露帳號是否存在）
      const ghost = { email: 'ghost@example.com', password: 'WrongPassword!2026' };
      for (let attempt = 0; attempt < 3; attempt += 1) {
        // oxlint-disable-next-line no-await-in-loop -- 依序送出才有確定的次數
        await login(ghost).expect(401);
      }
      expect(errorCode(await login(ghost).expect(429))).toBe('RATE_LIMITED');

      await clearLoginDelay(app, slow.email);
      await login(slow).expect(200);
    });

    it('已知來源的錯誤密碼不累計鎖定：知道 email 的人不能把對方鎖住，對方照常登入', async () => {
      const regular = { email: 'regular@example.com', password: 'RegularPassword!2026' };
      const id = await createUser(regular.email, regular.password);
      await login(regular).expect(200);
      for (let attempt = 0; attempt < MAX_ATTEMPTS + 1; attempt += 1) {
        // oxlint-disable-next-line no-await-in-loop -- 依序送出才有確定的次數
        await login({ email: regular.email, password: 'WrongPassword!2026' }).expect(401);
        // oxlint-disable-next-line no-await-in-loop -- 只看鎖定，不看延遲
        await clearLoginDelay(app, regular.email);
      }
      expect(await userOf(regular.email)).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
      const failures = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'auth.login.failure'), eq(auditLogs.resourceId, id)));
      expect(failures).toHaveLength(MAX_ATTEMPTS + 1);
      expect(
        failures.every((row) => (row.metadata as { reason?: string }).reason === 'known_source'),
      ).toBe(true);
      await login(regular).expect(200);
    });
  });

  describe('帳號列舉防護：狀態在驗證密碼之後才判斷（docs/architecture/backend/04-auth.md §3.2）', () => {
    it('未啟用、停用的帳號，密碼錯時與不存在的帳號同樣是 AUTH_INVALID_CREDENTIALS', async () => {
      await createUser('pending-enum@example.com', 'PendingPassword!2026', { status: 'pending' });
      await createUser('inactive-enum@example.com', 'InactivePassword!2026', {
        status: 'inactive',
      });
      for (const email of [
        'pending-enum@example.com',
        'inactive-enum@example.com',
        'nobody@example.com',
      ]) {
        // oxlint-disable-next-line no-await-in-loop -- 逐一比對
        const response = await login({ email, password: 'NotThePassword!2026' }).expect(401);
        expect(errorCode(response)).toBe('AUTH_INVALID_CREDENTIALS');
      }
    });

    it('密碼正確時才告知狀態（使用者需要知道怎麼辦）', async () => {
      const pending = await login({
        email: 'pending-enum@example.com',
        password: 'PendingPassword!2026',
      }).expect(401);
      expect(errorCode(pending)).toBe('AUTH_ACCOUNT_PENDING');
      const inactive = await login({
        email: 'inactive-enum@example.com',
        password: 'InactivePassword!2026',
      }).expect(403);
      expect(errorCode(inactive)).toBe('AUTH_ACCOUNT_DISABLED');
    });

    it('密碼正確但未啟用、停用：各留一筆失敗的稽核（憑證外洩的訊號要查得到）', async () => {
      const pending = await userOf('pending-enum@example.com');
      const inactive = await userOf('inactive-enum@example.com');
      expect(await rejectedLoginsOf(pending.id)).toContainEqual(
        expect.objectContaining({
          errorCode: 'AUTH_ACCOUNT_PENDING',
          metadata: expect.objectContaining({ reason: 'pending', credentialsValid: true }),
        }),
      );
      expect(await rejectedLoginsOf(inactive.id)).toContainEqual(
        expect.objectContaining({
          errorCode: 'AUTH_ACCOUNT_DISABLED',
          metadata: expect.objectContaining({ reason: 'disabled', credentialsValid: true }),
        }),
      );
    });
  });

  describe('啟用與重設 token', () => {
    it('pending 被停用後，手上的啟用信不能把自己改回 active', async () => {
      const admin = await tokenOf(ADMIN);
      const id = await createUser('stopped@example.com', null, { status: 'pending' });
      const raw = await issueToken(id, 'activation');

      await request(http)
        .patch(`/users/${id}`)
        .set('authorization', `Bearer ${admin}`)
        .send({ status: 'inactive', version: await userVersion(db, id) })
        .expect(200);
      // 停用時未使用的 token 一併作廢
      const unused = await db
        .select()
        .from(authTokens)
        .where(and(eq(authTokens.userId, id), eq(authTokens.purpose, 'activation')));
      expect(unused.every((row) => row.usedAt !== null)).toBe(true);

      const verify = await request(http).get(`/auth/setup/verify?token=${raw}`).expect(200);
      expect((verify.body as { data: { valid: boolean } }).data.valid).toBe(false);
      const setup = await request(http)
        .post('/auth/setup')
        .send({ token: raw, password: 'StoppedPassword!2026' })
        .expect(400);
      expect(errorCode(setup)).toBe('AUTH_SETUP_TOKEN_INVALID');
      expect((await userOf('stopped@example.com')).status).toBe('inactive');
    });

    it('就算 token 沒被作廢，setup 也只接受 pending 的人', async () => {
      const id = await createUser('already-active@example.com', 'ActivePassword!2026');
      const raw = await issueToken(id, 'activation');
      const response = await request(http)
        .post('/auth/setup')
        .send({ token: raw, password: 'AnotherPassword!2026' })
        .expect(400);
      expect(errorCode(response)).toBe('AUTH_SETUP_TOKEN_INVALID');
    });

    it('同一個重設連結被併發送出兩次：恰好一次成功', async () => {
      const id = await createUser('double-click@example.com', 'DoubleClickPassword!2026');
      const raw = await issueToken(id, 'password_reset');
      const responses = await Promise.all(
        ['FirstResetPassword!2026', 'SecondResetPassword!2026'].map((newPassword) =>
          request(http).post('/auth/reset-password').send({ token: raw, newPassword }),
        ),
      );
      expect(responses.map((response) => response.status).toSorted()).toEqual([200, 400]);
      const resets = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'auth.password_reset'), eq(auditLogs.resourceId, id)));
      expect(resets).toHaveLength(1);
    });

    it('密碼含 email 的帳號名稱或租戶代碼 → VALIDATION_FAILED', async () => {
      const id = await createUser('winston@example.com', null, { status: 'pending' });
      const raw = await issueToken(id, 'activation');
      const response = await request(http)
        .post('/auth/setup')
        .send({ token: raw, password: 'Winston-Churchill-1940' })
        .expect(400);
      expect(response.body).toMatchObject({
        error: {
          code: 'VALIDATION_FAILED',
          details: { fields: { password: 'AUTH_PASSWORD_WEAK' } },
        },
      });
    });
  });

  describe('還沒啟用的人', () => {
    it('管理員不能把 pending 直接改成 active：仍要靠啟用信證明擁有這個 email', async () => {
      const admin = await tokenOf(ADMIN);
      const credentials = { email: 'claimed@example.com', password: 'ApplicantPassword!2026' };
      // 註冊申請核准後的帳號：pending，但已經存了申請人設定的密碼
      const id = await createUser(credentials.email, credentials.password, { status: 'pending' });

      const response = await request(http)
        .patch(`/users/${id}`)
        .set('authorization', `Bearer ${admin}`)
        .send({ status: 'active', version: await userVersion(db, id) })
        .expect(400);

      expect(response.body).toMatchObject({
        error: { code: 'VALIDATION_FAILED', details: { fields: { status: 'pending' } } },
      });
      expect((await userOf(credentials.email)).status).toBe('pending');
      expect(errorCode(await login(credentials).expect(401))).toBe('AUTH_ACCOUNT_PENDING');
    });

    it('pending 先停用再啟用：申請時存的密碼已清掉，不能拿來登入', async () => {
      const admin = await tokenOf(ADMIN);
      const credentials = { email: 'detour@example.com', password: 'ApplicantPassword!2026' };
      const id = await createUser(credentials.email, credentials.password, { status: 'pending' });

      for (const status of ['inactive', 'active'] as const) {
        // oxlint-disable-next-line no-await-in-loop -- 依序改兩次狀態
        await request(http)
          .patch(`/users/${id}`)
          .set('authorization', `Bearer ${admin}`)
          .send({ status, version: await userVersion(db, id) })
          .expect(200);
      }

      expect((await userOf(credentials.email)).passwordHash).toBeNull();
      expect(errorCode(await login(credentials).expect(401))).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('不能把人改回 pending（改了就再也沒有啟用 token）', async () => {
      const admin = await tokenOf(ADMIN);
      const target = await createUser('to-pending@example.com', 'ToPendingPassword!2026');
      const response = await request(http)
        .patch(`/users/${target}`)
        .set('authorization', `Bearer ${admin}`)
        .send({ status: 'pending', version: await userVersion(db, target) })
        .expect(400);
      expect(errorCode(response)).toBe('VALIDATION_FAILED');
    });

    it('管理員對 pending 的人按「重設密碼」＝重寄啟用信', async () => {
      const admin = await tokenOf(ADMIN);
      const id = await createUser('resend@example.com', null, { status: 'pending' });
      await request(http)
        .post(`/users/${id}/reset-password`)
        .set('authorization', `Bearer ${admin}`)
        .expect(200);
      const [log] = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.resourceId, id), eq(auditLogs.action, 'user.activation_resent')));
      expect(log).toBeDefined();
    });
  });

  describe('停用後改回 active 的反提權（docs/architecture/backend/05-rbac.md §4.1）', () => {
    const OPERATOR = {
      email: 'reactivate-operator@example.com',
      password: 'OperatorPassword!2026',
    };

    beforeAll(async () => {
      // 只能看與編輯使用者：沒有 admin 帶的其他權限
      const [role] = await db
        .insert(roles)
        .values({ slug: 'reactivate-operator', name: 'reactivate-operator', isSystem: false })
        .returning();
      await db
        .insert(relationTuples)
        .values(['user:read', 'user:update'].map((key) => rolePermissionTuple(role!.id, key)));
      const operator = await createUser(OPERATOR.email, OPERATOR.password);
      await db.insert(relationTuples).values(roleHolderTuple(role!.id, operator));
    });

    it('直接持有 admin 的人：只有 user:update 的人改回 active → 403 AUTHZ_ESCALATION，仍是 inactive', async () => {
      const id = await createUser('reactivate-direct@example.com', null, {
        roleSlug: 'admin',
        status: 'inactive',
      });
      const response = await reactivate(await tokenOf(OPERATOR), id);
      expect(response.status).toBe(403);
      expect(errorCode(response)).toBe('AUTHZ_ESCALATION');
      expect((await userOf('reactivate-direct@example.com')).status).toBe('inactive');
    });

    it('只經由群組持有 admin 的人一樣擋下；持有 admin 的人可以改回 active', async () => {
      const id = await createUser('reactivate-group@example.com', null, { status: 'inactive' });
      const [group] = await db.insert(groups).values({ name: '重新啟用：Admins' }).returning();
      await db
        .insert(relationTuples)
        .values([
          groupRoleTuple(await roleIdOf('admin'), group!.id),
          groupMemberTuple(group!.id, { type: 'user', id }),
        ]);

      const denied = await reactivate(await tokenOf(OPERATOR), id);
      expect(denied.status).toBe(403);
      expect(errorCode(denied)).toBe('AUTHZ_ESCALATION');
      expect((await userOf('reactivate-group@example.com')).status).toBe('inactive');

      expect((await reactivate(await tokenOf(ADMIN), id)).status).toBe(200);
      expect((await userOf('reactivate-group@example.com')).status).toBe('active');
    });

    it('停用不檢查（拿掉能力不是提權）；沒有角色的人改回 active 不受影響', async () => {
      const operator = await tokenOf(OPERATOR);
      const id = await createUser('reactivate-plain@example.com', null);
      await request(http)
        .patch(`/users/${id}`)
        .set('authorization', `Bearer ${operator}`)
        .send({ status: 'inactive', version: await userVersion(db, id) })
        .expect(200);
      expect((await reactivate(operator, id)).status).toBe(200);
    });
  });

  describe('管理 super-admin', () => {
    let rootId = '';
    let root2Id = '';

    beforeAll(async () => {
      rootId = (await userOf(ROOT.email)).id;
      root2Id = await createUser(ROOT_2.email, ROOT_2.password, { roleSlug: 'super-admin' });
    });

    it.each([
      ['停用', 'patch', (id: string) => `/users/${id}`, { status: 'inactive' }],
      ['刪除', 'delete', (id: string) => `/users/${id}`, undefined],
      ['改角色', 'put', (id: string) => `/users/${id}/roles`, 'member'],
    ] as const)(
      'admin %s super-admin → 403 AUTHZ_ESCALATION',
      async (_label, method, path, body) => {
        const admin = await tokenOf(ADMIN);
        const payload =
          body === 'member'
            ? {
                roleIds: [await roleIdOf('member')],
                expectedRoleIds: await currentRoleIds(db, root2Id),
              }
            : body && { ...body, version: await userVersion(db, root2Id) };
        const agent = request(http);
        const response = await agent[method](path(root2Id))
          .set('authorization', `Bearer ${admin}`)
          .send(payload ?? {})
          .expect(403);
        expect(response.body).toMatchObject({
          error: { code: 'AUTHZ_ESCALATION', details: { role: 'super-admin' } },
        });
        expect((await userOf(ROOT_2.email)).status).toBe('active');
      },
    );

    it('super-admin 可以管理另一位 super-admin', async () => {
      const root = await tokenOf(ROOT);
      await request(http)
        .patch(`/users/${root2Id}`)
        .set('authorization', `Bearer ${root}`)
        .send({ status: 'inactive', version: await userVersion(db, root2Id) })
        .expect(200);
      await request(http)
        .patch(`/users/${root2Id}`)
        .set('authorization', `Bearer ${root}`)
        .send({ status: 'active', version: await userVersion(db, root2Id) })
        .expect(200);
    });

    it('兩位 super-admin 同時刪除對方：恰好一個 LAST_SUPER_ADMIN，至少留下一位', async () => {
      const [root, root2] = await Promise.all([tokenOf(ROOT), tokenOf(ROOT_2)]);
      const responses = await Promise.all([
        request(http).delete(`/users/${root2Id}`).set('authorization', `Bearer ${root}`),
        request(http).delete(`/users/${rootId}`).set('authorization', `Bearer ${root2}`),
      ]);
      const statuses = responses.map((response) => response.status).toSorted();
      expect(statuses).toEqual([204, 403]);
      expect(responses.map(errorCode)).toContain('LAST_SUPER_ADMIN');

      const remaining = await db
        .select({ id: users.id })
        .from(users)
        .innerJoin(
          relationTuples,
          and(isRoleHolderTuple(), eq(relationTuples.subjectId, sql`${users.id}::text`)),
        )
        .innerJoin(roles, eq(sql`${roles.id}::text`, relationTuples.objectId))
        .where(
          and(eq(roles.slug, 'super-admin'), eq(users.status, 'active'), isNull(users.deletedAt)),
        );
      expect(remaining).toHaveLength(1);
    });
  });

  describe('整批取代角色的衝突', () => {
    it('送出的草稿所依據的角色已被別人改過 → 409 USER_ROLES_CONFLICT，不覆寫', async () => {
      const admin = await tokenOf(ADMIN);
      const target = await createUser('draft@example.com', 'DraftPassword!2026', {
        roleSlug: 'member',
      });
      const [memberId, auditorId] = await Promise.all([roleIdOf('member'), roleIdOf('auditor')]);

      // B 先把角色改成 member ＋ auditor
      await request(http)
        .put(`/users/${target}/roles`)
        .set('authorization', `Bearer ${admin}`)
        .send({ roleIds: [memberId, auditorId], expectedRoleIds: [memberId] })
        .expect(200);

      // A 的草稿還是以「只有 member」為基礎
      const response = await request(http)
        .put(`/users/${target}/roles`)
        .set('authorization', `Bearer ${admin}`)
        .send({ roleIds: [], expectedRoleIds: [memberId] })
        .expect(409);
      expect(response.body).toMatchObject({
        error: {
          code: 'USER_ROLES_CONFLICT',
          details: { currentRoleIds: expect.arrayContaining([memberId, auditorId]) },
        },
      });
      expect(await heldRoleIds(db, target)).toHaveLength(2);
    });
  });
});
