import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { approvalRequests, auditLogs, roles, userRoles, users } from '@/db/schema';
import type { UserStatus } from '@/db/schema';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;

const SUPER_ADMIN = { email: 'batch-root@example.com', password: 'RootPassword!2026' };
const ADMIN = { email: 'batch-admin@example.com', password: 'AdminPassword!2026' };
const MEMBER = { email: 'batch-member@example.com', password: 'MemberPassword!2026' };

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

interface BatchBody {
  data: { succeeded: string[]; failed: Array<{ id: string; code: string; details?: unknown }> };
}

/** 登入端點有速率限制，同一個帳號的 token 重用。 */
const tokenCache = new Map<string, string>();

async function login(credentials: { email: string; password: string }): Promise<string> {
  const cached = tokenCache.get(credentials.email);
  if (cached) return cached;
  const response = await request(http).post('/auth/login').send(credentials).expect(200);
  const token = (response.body as { data: { accessToken: string } }).data.accessToken;
  tokenCache.set(credentials.email, token);
  return token;
}

let seq = 0;

/** 直接寫 DB 建立使用者（不需要登入的對象不設密碼）。 */
async function createUser(
  options: { roleSlug?: string; status?: UserStatus; email?: string; password?: string } = {},
): Promise<string> {
  seq += 1;
  const passwordHash = options.password
    ? await (await import('@/modules/auth/password')).hashPassword(options.password)
    : null;
  const [user] = await db
    .insert(users)
    .values({
      email: options.email ?? `batch-target-${seq}@example.com`,
      displayName: `target ${seq}`,
      passwordHash,
      status: options.status ?? 'active',
    })
    .returning();
  if (options.roleSlug) {
    const [role] = await db.select().from(roles).where(eq(roles.slug, options.roleSlug));
    await db.insert(userRoles).values({ userId: user!.id, roleId: role!.id });
  }
  return user!.id;
}

async function createRole(name: string): Promise<string> {
  const [role] = await db.insert(roles).values({ slug: name, name }).returning();
  return role!.id;
}

/** 直接寫 DB 建立一筆待審的註冊申請。 */
async function createRegistration(
  email = `batch-apply-${(seq += 1)}@example.com`,
): Promise<string> {
  const [row] = await db
    .insert(approvalRequests)
    .values({
      type: 'user.register',
      subjectKey: email.toLowerCase(),
      payload: { email, displayName: email },
      privatePayload: { passwordHash: 'hash' },
      requesterName: email,
    })
    .returning();
  return row!.id;
}

async function userIdOf(email: string): Promise<string> {
  const [user] = await db.select().from(users).where(eq(users.email, email));
  return user!.id;
}

async function post(path: string, body: object, as = SUPER_ADMIN) {
  return request(http)
    .post(path)
    .set('authorization', `Bearer ${await login(as)}`)
    .send(body);
}

describe('批次端點（docs/adr/0009-table-batch-operations.md）', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = inject('databaseUrl');
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN.email;
    process.env.SUPER_ADMIN_PASSWORD = SUPER_ADMIN.password;

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);

    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);
    await createUser({ roleSlug: 'admin', ...ADMIN });
    await createUser({ roleSlug: 'member', ...MEMBER });

    const { AppModule } = await import('@/app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    http = app.getHttpServer() as App;
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  describe('POST /users/batch-delete', () => {
    it('部分成功：自己與不存在的 id 回報在 failed，其餘刪除', async () => {
      const self = await userIdOf(SUPER_ADMIN.email);
      const a = await createUser({ roleSlug: 'member' });
      const b = await createUser();

      const response = await post('/users/batch-delete', { ids: [a, self, MISSING_ID, b] });

      expect(response.status).toBe(200);
      expect((response.body as BatchBody).data).toEqual({
        succeeded: [a, b],
        failed: [
          { id: self, code: 'AUTHZ_SELF_MODIFY' },
          { id: MISSING_ID, code: 'USER_NOT_FOUND' },
        ],
      });
      const rows = await db
        .select()
        .from(users)
        .where(inArray(users.id, [a, b, self]));
      expect(
        rows
          .filter((row) => row.deletedAt !== null)
          .map((row) => row.id)
          .toSorted(),
      ).toEqual([a, b].toSorted());
    });

    it('每筆一條稽核，同一批共用 requestId 並標記 batch', async () => {
      const a = await createUser();
      const b = await createUser();
      expect((await post('/users/batch-delete', { ids: [a, b] })).status).toBe(200);

      const rows = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'user.delete'), inArray(auditLogs.resourceId, [a, b])));
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.metadata?.batch)).toEqual([{ size: 2 }, { size: 2 }]);
      expect(new Set(rows.map((row) => row.metadata?.requestId)).size).toBe(1);
    });

    it('依序檢查：同一批刪到只剩最後一位 super-admin 時，那一筆被擋下', async () => {
      const root = await userIdOf(SUPER_ADMIN.email);
      const second = await createUser({ roleSlug: 'super-admin' });

      const response = await post('/users/batch-delete', { ids: [second, root] }, ADMIN);

      expect((response.body as BatchBody).data).toEqual({
        succeeded: [second],
        failed: [{ id: root, code: 'LAST_SUPER_ADMIN' }],
      });
    });

    it('沒有 user:delete → 整批 403，不進 failed', async () => {
      const a = await createUser();
      const response = await post('/users/batch-delete', { ids: [a] }, MEMBER);
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ error: { code: 'AUTHZ_FORBIDDEN' } });
    });

    it.each([
      ['空陣列', []],
      ['重複的 id', [MISSING_ID, MISSING_ID]],
      ['超過 200 筆', Array.from({ length: 201 }, () => MISSING_ID)],
    ])('%s → 400 VALIDATION_FAILED', async (_, ids) => {
      const response = await post('/users/batch-delete', { ids });
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    });
  });

  describe('POST /users/batch-status', () => {
    it('停用：已經停用的算成功但不寫稽核，並撤銷被停用者的 session', async () => {
      const active = await createUser();
      const inactive = await createUser({ status: 'inactive' });
      const [before] = await db.select().from(users).where(eq(users.id, active));

      const response = await post('/users/batch-status', {
        ids: [active, inactive],
        status: 'inactive',
      });

      expect((response.body as BatchBody).data).toEqual({
        succeeded: [active, inactive],
        failed: [],
      });
      const [after] = await db.select().from(users).where(eq(users.id, active));
      expect(after!.status).toBe('inactive');
      expect(after!.tokenVersion).toBe(before!.tokenVersion + 1);

      const audits = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'user.update'),
            inArray(auditLogs.resourceId, [active, inactive]),
          ),
        );
      expect(audits.map((row) => row.resourceId)).toEqual([active]);
    });

    it('啟用', async () => {
      const inactive = await createUser({ status: 'inactive' });
      const response = await post('/users/batch-status', { ids: [inactive], status: 'active' });

      expect((response.body as BatchBody).data.succeeded).toEqual([inactive]);
      const [after] = await db.select().from(users).where(eq(users.id, inactive));
      expect(after!.status).toBe('active');
    });

    it('不能停用自己', async () => {
      const self = await userIdOf(ADMIN.email);
      const response = await post(
        '/users/batch-status',
        { ids: [self], status: 'inactive' },
        ADMIN,
      );
      expect((response.body as BatchBody).data.failed).toEqual([
        { id: self, code: 'AUTHZ_SELF_MODIFY' },
      ]);
    });

    it('只接受 active / inactive', async () => {
      const a = await createUser();
      const response = await post('/users/batch-status', { ids: [a], status: 'pending' });
      expect(response.status).toBe(400);
    });
  });

  describe('POST /users/batch-unlock', () => {
    it('解鎖被鎖定的使用者；沒被鎖定的回報 USER_NOT_LOCKED', async () => {
      const locked = await createUser({ status: 'locked' });
      const active = await createUser();

      const response = await post('/users/batch-unlock', { ids: [locked, active] });

      expect((response.body as BatchBody).data).toEqual({
        succeeded: [locked],
        failed: [{ id: active, code: 'USER_NOT_LOCKED' }],
      });
      const [after] = await db.select().from(users).where(eq(users.id, locked));
      expect(after!.status).toBe('active');
    });
  });

  describe('POST /roles/batch-delete', () => {
    it('系統角色與有人持有的角色回報在 failed，其餘刪除', async () => {
      const [admin] = await db.select().from(roles).where(eq(roles.slug, 'admin'));
      const unused = await createRole('batch-unused');
      const inUse = await createRole('batch-in-use');
      const holder = await createUser();
      await db.insert(userRoles).values({ userId: holder, roleId: inUse });

      const response = await post('/roles/batch-delete', { ids: [unused, admin!.id, inUse] });

      expect(response.status).toBe(200);
      expect((response.body as BatchBody).data).toEqual({
        succeeded: [unused],
        failed: [
          { id: admin!.id, code: 'ROLE_SYSTEM_PROTECTED' },
          { id: inUse, code: 'ROLE_IN_USE', details: { userCount: 1 } },
        ],
      });
      const [deleted] = await db.select().from(roles).where(eq(roles.id, unused));
      expect(deleted!.deletedAt).not.toBeNull();
    });

    it('沒有 role:delete → 整批 403', async () => {
      const role = await createRole('batch-forbidden');
      const response = await post('/roles/batch-delete', { ids: [role] }, MEMBER);
      expect(response.status).toBe(403);
    });
  });

  describe('POST /approvals/batch-approve、batch-reject', () => {
    it('核准：建立已啟用、無角色的帳號；email 已被使用的回報在 failed', async () => {
      const ok = await createRegistration();
      const taken = `batch-taken-${(seq += 1)}@example.com`;
      await createUser({ email: taken });
      const duplicate = await createRegistration(taken);

      const response = await post('/approvals/batch-approve', { ids: [ok, duplicate, MISSING_ID] });

      expect(response.status).toBe(200);
      expect((response.body as BatchBody).data).toEqual({
        succeeded: [ok],
        failed: [
          {
            id: duplicate,
            code: 'USER_EMAIL_DUPLICATE',
            details: { field: 'email', value: taken },
          },
          { id: MISSING_ID, code: 'APPROVAL_NOT_FOUND' },
        ],
      });
      const [approved] = await db
        .select()
        .from(approvalRequests)
        .where(eq(approvalRequests.id, ok));
      expect(approved).toMatchObject({ status: 'approved', reviewComment: null });
      const [user] = await db.select().from(users).where(eq(users.id, approved!.resultResourceId!));
      expect(user!.status).toBe('active');
      expect(await db.select().from(userRoles).where(eq(userRoles.userId, user!.id))).toEqual([]);
    });

    it('駁回：已審核過的回報 APPROVAL_ALREADY_REVIEWED', async () => {
      const pending = await createRegistration();
      const done = await createRegistration();
      expect((await post('/approvals/batch-reject', { ids: [done] })).status).toBe(200);

      const response = await post('/approvals/batch-reject', { ids: [pending, done] });

      expect((response.body as BatchBody).data).toEqual({
        succeeded: [pending],
        failed: [{ id: done, code: 'APPROVAL_ALREADY_REVIEWED' }],
      });
      const [rejected] = await db
        .select()
        .from(approvalRequests)
        .where(eq(approvalRequests.id, pending));
      expect(rejected!.status).toBe('rejected');
    });

    it('沒有 approval:review → 整批 403', async () => {
      const id = await createRegistration();
      const response = await post('/approvals/batch-reject', { ids: [id] }, MEMBER);
      expect(response.status).toBe(403);
    });
  });
});
