import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import type { Response } from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { permissions, rolePermissions, roles, userRoles, users } from '@/db/schema';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;

const SUPER_ADMIN = { email: 'root@example.com', password: 'RootPassword!2026' };
const ADMIN = { email: 'admin-user@example.com', password: 'AdminPassword!2026' };
const MEMBER = { email: 'member-user@example.com', password: 'MemberPassword!2026' };

/**
 * Access token 不內嵌權限，所以同一個 token 可以跨測試重用——
 * 而且登入端點本身有速率限制（10 次 / 分 / IP），重複登入會撞到 429。
 */
const tokenCache = new Map<string, string>();

async function login(credentials: { email: string; password: string }): Promise<string> {
  const cached = tokenCache.get(credentials.email);
  if (cached) return cached;
  const response = await request(http).post('/auth/login').send(credentials).expect(200);
  const token = (response.body as { data: { accessToken: string } }).data.accessToken;
  tokenCache.set(credentials.email, token);
  return token;
}

async function createActiveUser(
  email: string,
  password: string,
  roleSlug?: string,
): Promise<string> {
  const { hashPassword } = await import('@/modules/auth/password');
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
    await db.insert(userRoles).values({ userId: user!.id, roleId: role!.id });
  }
  return user!.id;
}

describe('RBAC 生命週期（docs/overview/03-roadmap.md M4 驗收）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN.email;
    process.env.SUPER_ADMIN_PASSWORD = SUPER_ADMIN.password;
    process.env.PERMISSION_CACHE_TTL = '60';

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);

    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);

    await createActiveUser(ADMIN.email, ADMIN.password, 'admin');
    await createActiveUser(MEMBER.email, MEMBER.password, 'member');

    const { AppModule } = await import('@/app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    http = await listenOnLoopback(app);
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('super-admin 登入後取得展開成全集的權限', async () => {
    const token = await login(SUPER_ADMIN);
    const response = await request(http)
      .get('/auth/profile')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const body = response.body as {
      data: { permissions: string[]; roles: Array<{ slug: string }> };
    };
    expect(body.data.permissions).toHaveLength(29);
    expect(body.data.roles.map((role) => role.slug)).toContain('super-admin');
  });

  it('member 進入使用者列表 → 403 並帶出缺少的權限', async () => {
    const token = await login(MEMBER);
    const response = await request(http)
      .get('/users')
      .set('authorization', `Bearer ${token}`)
      .expect(403);
    expect(response.body).toMatchObject({
      error: { code: 'AUTHZ_FORBIDDEN', details: { missing: ['user:read'] } },
    });
  });

  it('403 會寫入 authz.denied 稽核', async () => {
    const token = await login(SUPER_ADMIN);
    const response = await request(http)
      .get('/audit-logs?action=authz.denied')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const body = response.body as { data: { items: Array<{ action: string; result: string }> } };
    expect(body.data.items.length).toBeGreaterThan(0);
    expect(body.data.items[0]).toMatchObject({ action: 'authz.denied', result: 'failure' });
  });

  it('admin 不能授予自己未持有的權限（AUTHZ_ESCALATION）', async () => {
    const token = await login(ADMIN);
    const response = await request(http)
      .post('/roles')
      .set('authorization', `Bearer ${token}`)
      .send({ name: '提權測試', permissionKeys: ['system:update'] })
      .expect(403);
    expect(response.body).toMatchObject({
      error: { code: 'AUTHZ_ESCALATION', details: { missing: ['system:update'] } },
    });
  });

  describe('指派 super-admin 角色（隱含全集，role_permissions 沒有列）', () => {
    async function superAdminRoleId(): Promise<string> {
      const [role] = await db.select().from(roles).where(eq(roles.slug, 'super-admin'));
      return role!.id;
    }

    it('admin 以 PUT /users/:id/roles 指派 super-admin → AUTHZ_ESCALATION', async () => {
      const token = await login(ADMIN);
      const targetId = await createActiveUser('escalate-put@example.com', 'EscalatePut!2026');
      const response = await request(http)
        .put(`/users/${targetId}/roles`)
        .set('authorization', `Bearer ${token}`)
        .send({ roleIds: [await superAdminRoleId()] })
        .expect(403);
      expect(response.body).toMatchObject({
        error: {
          code: 'AUTHZ_ESCALATION',
          details: { role: 'super-admin', missing: expect.arrayContaining(['system:update']) },
        },
      });
    });

    it('admin 以 POST /users 建立帶 super-admin 的使用者 → AUTHZ_ESCALATION', async () => {
      const token = await login(ADMIN);
      const response = await request(http)
        .post('/users')
        .set('authorization', `Bearer ${token}`)
        .send({
          email: 'escalate-post@example.com',
          displayName: '提權測試',
          roleIds: [await superAdminRoleId()],
        })
        .expect(403);
      expect(response.body).toMatchObject({
        error: { code: 'AUTHZ_ESCALATION', details: { role: 'super-admin' } },
      });
      const [created] = await db
        .select()
        .from(users)
        .where(eq(users.email, 'escalate-post@example.com'));
      expect(created).toBeUndefined();
    });

    it('super-admin 本人仍可指派 super-admin', async () => {
      const token = await login(SUPER_ADMIN);
      const targetId = await createActiveUser('promote@example.com', 'PromotePassword!2026');
      await request(http)
        .put(`/users/${targetId}/roles`)
        .set('authorization', `Bearer ${token}`)
        .send({ roleIds: [await superAdminRoleId()] })
        .expect(200);

      // 還原：後面的 LAST_SUPER_ADMIN 測試假設 root 是唯一的 super-admin
      const [memberRole] = await db.select().from(roles).where(eq(roles.slug, 'member'));
      await request(http)
        .put(`/users/${targetId}/roles`)
        .set('authorization', `Bearer ${token}`)
        .send({ roleIds: [memberRole!.id] })
        .expect(200);
    });
  });

  it('建立角色 → 指派給 member → member 立刻能讀使用者列表', async () => {
    const adminToken = await login(ADMIN);
    const created = await request(http)
      .post('/roles')
      .set('authorization', `Bearer ${adminToken}`)
      .send({ name: '讀取者', permissionKeys: ['user:read'] })
      .expect(201);
    const roleId = (created.body as { data: { id: string } }).data.id;

    const [member] = await db.select().from(users).where(eq(users.email, MEMBER.email));
    const [memberRole] = await db.select().from(roles).where(eq(roles.slug, 'member'));
    await request(http)
      .put(`/users/${member!.id}/roles`)
      .set('authorization', `Bearer ${adminToken}`)
      .send({ roleIds: [roleId, memberRole!.id] })
      .expect(200);

    const memberToken = await login(MEMBER);
    await request(http).get('/users').set('authorization', `Bearer ${memberToken}`).expect(200);
  });

  it('移除角色權限後，member 的「下一次請求」即被拒絕（不等 TTL）', async () => {
    const adminToken = await login(ADMIN);
    const list = await request(http)
      .get('/roles?keyword=讀取者')
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200);
    const roleId = (list.body as { data: { items: Array<{ id: string }> } }).data.items[0]!.id;

    const memberToken = await login(MEMBER);
    await request(http).get('/users').set('authorization', `Bearer ${memberToken}`).expect(200);

    await request(http)
      .patch(`/roles/${roleId}/permissions`)
      .set('authorization', `Bearer ${adminToken}`)
      .send({ add: [], remove: ['user:read'] })
      .expect(200);

    // 同一個 access token，不需要重新登入
    await request(http).get('/users').set('authorization', `Bearer ${memberToken}`).expect(403);
  });

  it('系統角色不可刪除（ROLE_SYSTEM_PROTECTED）', async () => {
    const token = await login(ADMIN);
    const [role] = await db.select().from(roles).where(eq(roles.slug, 'auditor'));
    const response = await request(http)
      .delete(`/roles/${role!.id}`)
      .set('authorization', `Bearer ${token}`)
      .expect(403);
    expect(response.body).toMatchObject({ error: { code: 'ROLE_SYSTEM_PROTECTED' } });
  });

  it('super-admin 角色的權限不可變更（ROLE_SUPER_ADMIN_IMMUTABLE）', async () => {
    const token = await login(SUPER_ADMIN);
    const [role] = await db.select().from(roles).where(eq(roles.slug, 'super-admin'));
    const response = await request(http)
      .patch(`/roles/${role!.id}/permissions`)
      .set('authorization', `Bearer ${token}`)
      .send({ add: ['user:read'], remove: [] })
      .expect(403);
    expect(response.body).toMatchObject({ error: { code: 'ROLE_SUPER_ADMIN_IMMUTABLE' } });
  });

  describe('管理者不能把自己鎖在外面（ROLE_SELF_LOCKOUT，docs/issues/03-edge-cases.md EDGE-12）', () => {
    const MANAGER = { email: 'role-manager@example.com', password: 'RoleManager!2026' };
    let managerRoleId: string;

    beforeAll(async () => {
      const [role] = await db
        .insert(roles)
        .values({ slug: 'role-manager', name: '角色管理員' })
        .returning();
      managerRoleId = role!.id;
      const keys = ['role:read', 'role:update', 'role:delete', 'role:grantPermission', 'user:read'];
      const rows = await db.select().from(permissions).where(inArray(permissions.key, keys));
      await db
        .insert(rolePermissions)
        .values(rows.map((row) => ({ roleId: managerRoleId, permissionId: row.id })));
      const managerId = await createActiveUser(MANAGER.email, MANAGER.password);
      await db.insert(userRoles).values({ userId: managerId, roleId: managerRoleId });
    });

    it('移除自己唯一管理角色上的 role:grantPermission → 403，權限不變', async () => {
      const token = await login(MANAGER);
      const response = await request(http)
        .patch(`/roles/${managerRoleId}/permissions`)
        .set('authorization', `Bearer ${token}`)
        .send({ add: [], remove: ['role:grantPermission'] })
        .expect(403);
      expect(response.body).toMatchObject({
        error: { code: 'ROLE_SELF_LOCKOUT', details: { lost: ['role:grantPermission'] } },
      });
      const kept = await db
        .select()
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, managerRoleId));
      expect(kept).toHaveLength(5);
    });

    it('移除自己角色上與管理角色無關的權限 → 200', async () => {
      const token = await login(MANAGER);
      await request(http)
        .patch(`/roles/${managerRoleId}/permissions`)
        .set('authorization', `Bearer ${token}`)
        .send({ add: [], remove: ['user:read'] })
        .expect(200);
    });

    it('force 刪除自己持有的唯一管理角色 → 403，角色仍在', async () => {
      const token = await login(MANAGER);
      const response = await request(http)
        .delete(`/roles/${managerRoleId}?force=true`)
        .set('authorization', `Bearer ${token}`)
        .expect(403);
      expect(response.body).toMatchObject({ error: { code: 'ROLE_SELF_LOCKOUT' } });
      const [role] = await db.select().from(roles).where(eq(roles.id, managerRoleId));
      expect(role?.deletedAt).toBeNull();
    });

    it('super-admin 豁免：可以改任何角色', async () => {
      const token = await login(SUPER_ADMIN);
      await request(http)
        .patch(`/roles/${managerRoleId}/permissions`)
        .set('authorization', `Bearer ${token}`)
        .send({ add: [], remove: ['role:grantPermission'] })
        .expect(200);
    });
  });

  it('同一個權限同時在 add 與 remove → 400（docs/issues/03-edge-cases.md EDGE-18）', async () => {
    const token = await login(SUPER_ADMIN);
    const [role] = await db.select().from(roles).where(eq(roles.slug, 'member'));
    const response = await request(http)
      .patch(`/roles/${role!.id}/permissions`)
      .set('authorization', `Bearer ${token}`)
      .send({ add: ['user:read'], remove: ['user:read'] })
      .expect(400);
    expect(response.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  describe('刪除角色與指派角色同時發生（docs/issues/03-edge-cases.md EDGE-19）', () => {
    /** 等到有連線卡在列鎖上：確定 HTTP 請求已經走到交易裡、正在等測試持有的鎖。 */
    async function waitForLockWait(): Promise<void> {
      await vi.waitFor(
        async () => {
          const rows = await db.execute<{ waiting: number }>(
            sql`SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
          );
          expect(rows[0]?.waiting).toBeGreaterThan(0);
        },
        { timeout: 5000, interval: 20 },
      );
    }

    it('刪除先鎖住角色 → 同時的指派等它提交，不留下指向已刪除角色的指派', async () => {
      const token = await login(SUPER_ADMIN);
      const [role] = await db.insert(roles).values({ slug: 'race-a', name: '競態 A' }).returning();
      const userId = await createActiveUser('race-a@example.com', 'RaceAPassword!2026');

      let assignment: Promise<Response> | undefined;
      await db.transaction(async (tx) => {
        await tx.select({ id: roles.id }).from(roles).where(eq(roles.id, role!.id)).for('update');
        await tx.update(roles).set({ deletedAt: new Date() }).where(eq(roles.id, role!.id));
        assignment = request(http)
          .put(`/users/${userId}/roles`)
          .set('authorization', `Bearer ${token}`)
          .send({ roleIds: [role!.id] })
          .then((response) => response);
        await waitForLockWait();
      });

      expect((await assignment)?.status).toBe(200);
      const rows = await db.select().from(userRoles).where(eq(userRoles.userId, userId));
      expect(rows).toEqual([]);
    });

    it('指派先鎖住角色 → 同時的刪除（沒有 force）重新計數後回 ROLE_IN_USE', async () => {
      const token = await login(SUPER_ADMIN);
      const [role] = await db.insert(roles).values({ slug: 'race-b', name: '競態 B' }).returning();
      const userId = await createActiveUser('race-b@example.com', 'RaceBPassword!2026');

      let deletion: Promise<Response> | undefined;
      await db.transaction(async (tx) => {
        await tx.select({ id: roles.id }).from(roles).where(eq(roles.id, role!.id)).for('share');
        await tx.insert(userRoles).values({ userId, roleId: role!.id });
        deletion = request(http)
          .delete(`/roles/${role!.id}`)
          .set('authorization', `Bearer ${token}`)
          .then((response) => response);
        await waitForLockWait();
      });

      const response = await deletion;
      expect(response?.status).toBe(409);
      expect(response?.body).toMatchObject({
        error: { code: 'ROLE_IN_USE', details: { userCount: 1 } },
      });
      const [kept] = await db.select().from(roles).where(eq(roles.id, role!.id));
      expect(kept?.deletedAt).toBeNull();
    });
  });

  it('不能刪除自己（AUTHZ_SELF_MODIFY）', async () => {
    const token = await login(ADMIN);
    const [admin] = await db.select().from(users).where(eq(users.email, ADMIN.email));
    const response = await request(http)
      .delete(`/users/${admin!.id}`)
      .set('authorization', `Bearer ${token}`)
      .expect(403);
    expect(response.body).toMatchObject({ error: { code: 'AUTHZ_SELF_MODIFY' } });
  });

  it('不能停用最後一位 super-admin（LAST_SUPER_ADMIN）', async () => {
    const token = await login(ADMIN);
    const [root] = await db.select().from(users).where(eq(users.email, SUPER_ADMIN.email));
    const response = await request(http)
      .patch(`/users/${root!.id}`)
      .set('authorization', `Bearer ${token}`)
      .send({ status: 'inactive' })
      .expect(403);
    expect(response.body).toMatchObject({ error: { code: 'LAST_SUPER_ADMIN' } });
  });

  it('使用者被停用後，既有 access token 立刻失效（AUTH_ACCOUNT_DISABLED）', async () => {
    const adminToken = await login(ADMIN);
    const victimId = await createActiveUser('victim@example.com', 'VictimPassword!2026', 'member');
    const victimToken = await login({
      email: 'victim@example.com',
      password: 'VictimPassword!2026',
    });

    await request(http)
      .get('/auth/profile')
      .set('authorization', `Bearer ${victimToken}`)
      .expect(200);

    await request(http)
      .patch(`/users/${victimId}`)
      .set('authorization', `Bearer ${adminToken}`)
      .send({ status: 'inactive' })
      .expect(200);

    const response = await request(http)
      .get('/auth/profile')
      .set('authorization', `Bearer ${victimToken}`);
    expect([401, 403]).toContain(response.status);
    expect((response.body as { error: { code: string } }).error.code).toMatch(
      /AUTH_ACCOUNT_DISABLED|AUTH_TOKEN_STALE/,
    );
  });

  it('未知權限鍵被 Zod 擋下（VALIDATION_FAILED）', async () => {
    const token = await login(ADMIN);
    const response = await request(http)
      .post('/roles')
      .set('authorization', `Bearer ${token}`)
      .send({ name: 'Typo 測試', permissionKeys: ['role:updte'] })
      .expect(400);
    expect(response.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  describe('角色名稱不分大小寫、Unicode 正規化（docs/issues/03-edge-cases.md EDGE-21）', () => {
    it('只差大小寫的名稱 → ROLE_NAME_DUPLICATE', async () => {
      const token = await login(SUPER_ADMIN);
      await request(http)
        .post('/roles')
        .set('authorization', `Bearer ${token}`)
        .send({ name: 'Editor Case' })
        .expect(201);
      const response = await request(http)
        .post('/roles')
        .set('authorization', `Bearer ${token}`)
        .send({ name: 'editor CASE' })
        .expect(409);
      expect(response.body).toMatchObject({ error: { code: 'ROLE_NAME_DUPLICATE' } });
    });

    it('NFC 與 NFD 的同一個名稱 → ROLE_NAME_DUPLICATE，存成 NFC', async () => {
      const token = await login(SUPER_ADMIN);
      const created = await request(http)
        .post('/roles')
        .set('authorization', `Bearer ${token}`)
        .send({ name: 'Café 角色' })
        .expect(201);
      expect((created.body as { data: { name: string } }).data.name).toBe('Café 角色');
      await request(http)
        .post('/roles')
        .set('authorization', `Bearer ${token}`)
        .send({ name: 'Café 角色' })
        .expect(409);
    });

    it('只改自己名稱的大小寫不算撞名', async () => {
      const token = await login(SUPER_ADMIN);
      const created = await request(http)
        .post('/roles')
        .set('authorization', `Bearer ${token}`)
        .send({ name: 'recase me' })
        .expect(201);
      const id = (created.body as { data: { id: string } }).data.id;
      const response = await request(http)
        .patch(`/roles/${id}`)
        .set('authorization', `Bearer ${token}`)
        .send({ name: 'Recase Me' })
        .expect(200);
      expect((response.body as { data: { name: string } }).data.name).toBe('Recase Me');
    });
  });

  describe('輸入錯誤回可理解的錯誤碼（docs/issues/03-edge-cases.md EDGE-17）', () => {
    it('重複的 roleIds → 400 VALIDATION_FAILED（不是 500）', async () => {
      const token = await login(SUPER_ADMIN);
      const targetId = await createActiveUser('dup-roles@example.com', 'DupRolesPassword!2026');
      const [memberRole] = await db.select().from(roles).where(eq(roles.slug, 'member'));
      const response = await request(http)
        .put(`/users/${targetId}/roles`)
        .set('authorization', `Bearer ${token}`)
        .send({ roleIds: [memberRole!.id, memberRole!.id] })
        .expect(400);
      expect(response.body).toMatchObject({
        error: { code: 'VALIDATION_FAILED', details: { fields: { roleIds: 'duplicate items' } } },
      });
    });

    it('路徑上的 id 不是 uuid → 400 VALIDATION_FAILED', async () => {
      const token = await login(SUPER_ADMIN);
      const response = await request(http)
        .get('/users/not-a-uuid')
        .set('authorization', `Bearer ${token}`)
        .expect(400);
      expect(response.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    });

    it('不存在的路徑 → 404 NOT_FOUND', async () => {
      const token = await login(SUPER_ADMIN);
      const response = await request(http)
        .get('/no-such-endpoint')
        .set('authorization', `Bearer ${token}`)
        .expect(404);
      expect(response.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
    });
  });

  it('未帶 token 一律 401', async () => {
    await request(http).get('/roles').expect(401);
  });

  it('/health 是公開的', async () => {
    await request(http).get('/health').expect(200);
  });
});
