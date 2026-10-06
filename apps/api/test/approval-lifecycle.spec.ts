import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  approvalRequests,
  auditLogs,
  relationTuples,
  roleHolderTuple,
  rolePermissionTuple,
  roles,
  users,
} from '@/db/schema';

import { heldRoleIds } from './authz';
import type { TestDatabase } from './db';
import { createTestDatabase, expectDbError, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { inTestTenant } from './tenant';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;

const SUPER_ADMIN = { email: 'approval-root@example.com', password: 'Quiet-Harbor-Lantern-26' };
const ADMIN = { email: 'approval-admin@example.com', password: 'AdminPassword!2026' };
const AUDITOR = { email: 'approval-auditor@example.com', password: 'AuditorPassword!2026' };
const MEMBER = { email: 'approval-member@example.com', password: 'MemberPassword!2026' };

const tokenCache = new Map<string, string>();

async function login(credentials: { email: string; password: string }): Promise<string> {
  const cached = tokenCache.get(credentials.email);
  if (cached) return cached;
  const response = await request(http).post('/auth/login').send(credentials).expect(200);
  const token = (response.body as { data: { accessToken: string } }).data.accessToken;
  tokenCache.set(credentials.email, token);
  return token;
}

async function roleIdOf(slug: string): Promise<string> {
  const [role] = await db.select().from(roles).where(eq(roles.slug, slug));
  return role!.id;
}

async function createActiveUser(email: string, password: string, roleSlug: string) {
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
  await db.insert(relationTuples).values(roleHolderTuple(await roleIdOf(roleSlug), user!.id));
}

function register(email: string, overrides: Record<string, unknown> = {}) {
  return request(http)
    .post('/auth/register')
    .send({
      email,
      displayName: `Applicant ${email}`,
      password: 'ApplicantPassword!2026',
      reason: '加入企劃團隊',
      ...overrides,
    });
}

async function pendingRequestOf(email: string) {
  const [row] = await db
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.subjectKey, email.toLowerCase()));
  return row;
}

describe('註冊審批（docs/rbac/06-approval.md）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN.email;
    process.env.SUPER_ADMIN_PASSWORD = SUPER_ADMIN.password;
    // 註冊端點的限流很嚴（每分鐘 3 次）；這裡要連續送出多筆
    process.env.AUTH_RATE_LIMIT = '300';

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);

    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);
    await createActiveUser(ADMIN.email, ADMIN.password, 'admin');
    await createActiveUser(AUDITOR.email, AUDITOR.password, 'auditor');
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

  it('送出註冊 → 202，建立一筆待審請求；密碼只以雜湊存在 private_payload', async () => {
    const response = await register('alice@example.com').expect(202);
    expect(response.body).toEqual({ data: { submitted: true } });

    const row = await pendingRequestOf('alice@example.com');
    expect(row).toMatchObject({
      type: 'user.register',
      status: 'pending',
      requesterId: null,
      requesterName: 'alice@example.com',
      reason: '加入企劃團隊',
      payload: { email: 'alice@example.com', displayName: 'Applicant alice@example.com' },
    });
    const secret = row!.privatePayload as { passwordHash: string };
    expect(secret.passwordHash).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify(row!.payload)).not.toContain('ApplicantPassword');

    // 還沒核准：帳號不存在
    expect(await db.select().from(users).where(eq(users.email, 'alice@example.com'))).toEqual([]);
  });

  it('同一個 email 再送一次（大小寫不同）→ 一樣回 202，但不會多一筆', async () => {
    await register('ALICE@example.com').expect(202);
    const rows = await db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.subjectKey, 'alice@example.com'));
    expect(rows).toHaveLength(1);
  });

  it('已經是使用者的 email → 一樣回 202，但不建立請求（帳號列舉防護）', async () => {
    await register(MEMBER.email).expect(202);
    expect(await pendingRequestOf(MEMBER.email)).toBeUndefined();
  });

  it('弱密碼 → 400 VALIDATION_FAILED', async () => {
    const response = await register('weak@example.com', { password: 'short' }).expect(400);
    expect(response.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('auditor 看得到列表，但不能核准', async () => {
    const token = await login(AUDITOR);
    const list = await request(http)
      .get('/approvals?status=pending')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const body = list.body as { data: { items: Array<Record<string, unknown>> } };
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]).not.toHaveProperty('privatePayload');

    const { id } = (await pendingRequestOf('alice@example.com'))!;
    const response = await request(http)
      .post(`/approvals/${id}/approve`)
      .set('authorization', `Bearer ${token}`)
      .send({})
      .expect(403);
    expect(response.body).toMatchObject({
      error: { code: 'AUTHZ_FORBIDDEN', details: { missing: ['approval:review'] } },
    });
  });

  it('member 連列表都看不到', async () => {
    const token = await login(MEMBER);
    await request(http).get('/approvals').set('authorization', `Bearer ${token}`).expect(403);
  });

  it('admin 核准並指派 member → 建立未啟用（pending）的帳號，要從啟用信完成設定才能登入', async () => {
    const token = await login(ADMIN);
    const { id } = (await pendingRequestOf('alice@example.com'))!;
    const response = await request(http)
      .post(`/approvals/${id}/approve`)
      .set('authorization', `Bearer ${token}`)
      .send({ comment: '歡迎', roleIds: [await roleIdOf('member')] })
      .expect(200);

    const approved = (response.body as { data: Record<string, unknown> }).data;
    expect(approved).toMatchObject({
      status: 'approved',
      reviewerName: ADMIN.email,
      reviewComment: '歡迎',
    });

    const [user] = await db.select().from(users).where(eq(users.email, 'alice@example.com'));
    // email 還沒驗證：申請人不一定真的擁有這個信箱
    expect(user).toMatchObject({ status: 'pending', displayName: 'Applicant alice@example.com' });
    expect(approved.resultResourceId).toBe(user!.id);
    expect(await heldRoleIds(db, user!.id)).toEqual([await roleIdOf('member')]);

    // 審核後不再保留密碼雜湊
    const [row] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, id));
    expect(row!.privatePayload).toBeNull();

    // 啟用前以申請時的密碼登入：提示去收信，而不是「帳密錯誤」
    const pending = await request(http)
      .post('/auth/login')
      .send({ email: 'alice@example.com', password: 'ApplicantPassword!2026' })
      .expect(401);
    expect(pending.body).toMatchObject({ error: { code: 'AUTH_ACCOUNT_PENDING' } });

    // 啟用信的連結（寄信工作在寄出當下才簽發 token；這裡直接簽一張）→ 設定密碼 → 可以登入
    const { AuthTokenService } = await import('@/modules/credential/auth-token.service');
    const { raw } = await inTestTenant(app, () =>
      app.get(AuthTokenService).issue(user!.id, 'activation'),
    );
    await request(http)
      .post('/auth/setup')
      .send({ token: raw, password: 'ApplicantPassword!2026' })
      .expect(200);
    await request(http)
      .post('/auth/login')
      .send({ email: 'alice@example.com', password: 'ApplicantPassword!2026' })
      .expect(200);
  });

  it('核准與建立使用者都有稽核，且不含密碼雜湊', async () => {
    const logs = await db
      .select({ action: auditLogs.action, changes: auditLogs.changes })
      .from(auditLogs);
    expect(logs.map((log) => log.action)).toEqual(
      expect.arrayContaining(['approval.submit', 'approval.approve', 'user.create']),
    );
    expect(JSON.stringify(logs)).not.toContain('argon2');
  });

  it('已審核過的請求再核准 → 409 APPROVAL_ALREADY_REVIEWED', async () => {
    const token = await login(ADMIN);
    const [row] = await db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.subjectKey, 'alice@example.com'));
    const response = await request(http)
      .post(`/approvals/${row!.id}/approve`)
      .set('authorization', `Bearer ${token}`)
      .send({})
      .expect(409);
    expect(response.body).toMatchObject({ error: { code: 'APPROVAL_ALREADY_REVIEWED' } });
  });

  it('駁回後同一個 email 可以重新申請', async () => {
    await register('bob@example.com').expect(202);
    const token = await login(ADMIN);
    const { id } = (await pendingRequestOf('bob@example.com'))!;
    await request(http)
      .post(`/approvals/${id}/reject`)
      .set('authorization', `Bearer ${token}`)
      .send({ comment: '請改用公司信箱' })
      .expect(200);

    expect(await db.select().from(users).where(eq(users.email, 'bob@example.com'))).toEqual([]);

    await register('bob@example.com').expect(202);
    const rows = await db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.subjectKey, 'bob@example.com'));
    expect(rows.map((item) => item.status).toSorted()).toEqual(['pending', 'rejected']);
  });

  it('申請之後 email 被管理員直接建立 → 核准失敗 USER_EMAIL_DUPLICATE，請求仍待審', async () => {
    await register('carol@example.com').expect(202);
    const token = await login(ADMIN);
    await request(http)
      .post('/users')
      .set('authorization', `Bearer ${token}`)
      .send({ email: 'carol@example.com', displayName: 'Carol' })
      .expect(201);

    const { id } = (await pendingRequestOf('carol@example.com'))!;
    const response = await request(http)
      .post(`/approvals/${id}/approve`)
      .set('authorization', `Bearer ${token}`)
      .send({})
      .expect(409);
    expect(response.body).toMatchObject({ error: { code: 'USER_EMAIL_DUPLICATE' } });
    const [row] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, id));
    expect(row!.status).toBe('pending');
  });

  it('核准時指派超出自己權限的角色 → AUTHZ_ESCALATION', async () => {
    // admin 沒有 system:update
    const [custom] = await db
      .insert(roles)
      .values({ slug: 'approval-system-operator', name: 'System Operator' })
      .returning();
    await db.insert(relationTuples).values(rolePermissionTuple(custom!.id, 'system:update'));

    await register('dave@example.com').expect(202);
    const token = await login(ADMIN);
    const { id } = (await pendingRequestOf('dave@example.com'))!;
    const response = await request(http)
      .post(`/approvals/${id}/approve`)
      .set('authorization', `Bearer ${token}`)
      .send({ roleIds: [custom!.id] })
      .expect(403);
    expect(response.body).toMatchObject({ error: { code: 'AUTHZ_ESCALATION' } });
  });

  it('不存在的請求 → 404 APPROVAL_NOT_FOUND', async () => {
    const token = await login(ADMIN);
    const response = await request(http)
      .get('/approvals/00000000-0000-4000-8000-000000000000')
      .set('authorization', `Bearer ${token}`)
      .expect(404);
    expect(response.body).toMatchObject({ error: { code: 'APPROVAL_NOT_FOUND' } });
  });

  it('只允許 SSO 的網域不接受註冊（AUTH_SSO_REQUIRED），也不產生審批', async () => {
    const token = await login(SUPER_ADMIN);
    await request(http)
      .post('/identity-providers')
      .set('authorization', `Bearer ${token}`)
      .send({
        name: 'Corp SSO',
        issuer: 'https://idp.test',
        clientId: 'b2b',
        clientSecret: 'top-secret',
        domains: [{ domain: 'sso-only.test', ssoOnly: true }],
      })
      .expect(201);
    const response = await register('carol@sso-only.test').expect(403);
    expect(response.body).toMatchObject({ error: { code: 'AUTH_SSO_REQUIRED' } });
    expect(await pendingRequestOf('carol@sso-only.test')).toBeUndefined();
  });

  describe('DB 約束', () => {
    it('同類型同對象只能有一筆待審', async () => {
      await expectDbError(
        db.insert(approvalRequests).values({
          type: 'user.register',
          subjectKey: 'dave@example.com',
          payload: {},
          requesterName: 'dave@example.com',
        }),
        /approval_requests_pending_subject_key/,
      );
    });

    it('待審的請求不能帶審核時間；已審核的必須有', async () => {
      await expectDbError(
        db.insert(approvalRequests).values({
          type: 'user.register',
          subjectKey: 'check-1@example.com',
          payload: {},
          requesterName: 'check-1@example.com',
          reviewedAt: new Date(),
        }),
        /approval_requests_reviewed_consistency/,
      );
      await expectDbError(
        db.insert(approvalRequests).values({
          type: 'user.register',
          status: 'approved',
          subjectKey: 'check-2@example.com',
          payload: {},
          requesterName: 'check-2@example.com',
        }),
        /approval_requests_reviewed_consistency/,
      );
    });
  });
});
