import { randomBytes, randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { Response } from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { auditLogs, authTokens, refreshTokens, users } from '@/db/schema';
import { AuthTokenCleanupJobs } from '@/modules/credential/auth-token-cleanup.jobs';
import { sha256 } from '@/modules/credential/token-hash';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { inTestTenant } from './tenant';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;

const COOKIE_NAME = 'refresh_token';
const DAY_MS = 24 * 60 * 60 * 1000;
const USER = { email: 'rotation@example.com', password: 'RotationPassword!2026' };

/** 從 Set-Cookie 取出新的 refresh token 原文。 */
function refreshCookieOf(response: Response): string {
  const header = response.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = header?.find((value) => value.startsWith(`${COOKIE_NAME}=`));
  if (!cookie) throw new Error('回應沒有設定 refresh cookie');
  return cookie.slice(COOKIE_NAME.length + 1).split(';')[0]!;
}

function postRefresh(raw: string) {
  return request(http)
    .post('/auth/refresh')
    .set('x-refresh-request', '1')
    .set('cookie', `${COOKIE_NAME}=${raw}`);
}

async function loginForCookie(): Promise<{ raw: string; accessToken: string }> {
  const response = await request(http).post('/auth/login').send(USER).expect(200);
  const accessToken = (response.body as { data: { accessToken: string } }).data.accessToken;
  return { raw: refreshCookieOf(response), accessToken };
}

function errorCodeOf(response: Response): string | undefined {
  return (response.body as { error?: { code?: string } }).error?.code;
}

describe('refresh token 輪替的併發（docs/architecture/backend/04-auth.md）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = 'root@example.com';
    process.env.SUPER_ADMIN_PASSWORD = 'Quiet-Harbor-Lantern-26';

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);

    const { hashPassword } = await import('@/modules/credential/password');
    await db.insert(users).values({
      email: USER.email,
      displayName: USER.email,
      passwordHash: await hashPassword(USER.password),
      status: 'active',
    });

    const { AppModule } = await import('@/app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    app.use(cookieParser());
    await app.init();
    http = await listenOnLoopback(app);
  });

  beforeEach(async () => {
    await db.delete(refreshTokens);
    await db.delete(authTokens);
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('正常輪替：每次續期換一張新的，新的可以再續期', async () => {
    const { raw } = await loginForCookie();
    const first = await postRefresh(raw).expect(200);
    await postRefresh(refreshCookieOf(first)).expect(200);
  });

  it('★ 同一張 refresh token 的併發請求：家族不會分岔，最後只有一張可用', async () => {
    const { raw } = await loginForCookie();

    const responses = await Promise.all(Array.from({ length: 5 }, () => postRefresh(raw)));

    // 寬限期內（REFRESH_REUSE_GRACE_SECONDS）的重送都換發，但每一次都取代前一張
    expect(responses.every((response) => response.status === 200)).toBe(true);
    const live = (await db.select().from(refreshTokens)).filter(
      (row) => row.usedAt === null && row.revokedAt === null,
    );
    expect(live).toHaveLength(1);
    const cookies = responses.map(refreshCookieOf);
    const survivor = cookies.find((cookie) => sha256(cookie) === live[0]!.tokenHash);
    expect(survivor).toBeDefined();
    for (const cookie of cookies.filter((item) => item !== survivor)) {
      // oxlint-disable-next-line no-await-in-loop -- 逐一確認
      expect(errorCodeOf(await postRefresh(cookie))).toBe('AUTH_REFRESH_REVOKED');
    }
    await postRefresh(survivor!).expect(200);
  });

  describe('重送寬限期', () => {
    it('續期的回應遺失、以舊 token 再續期 → 換發新的，不撤銷家族、不記重用', async () => {
      const { raw } = await loginForCookie();
      const lost = refreshCookieOf(await postRefresh(raw).expect(200));

      const retried = await postRefresh(raw).expect(200);
      await postRefresh(refreshCookieOf(retried)).expect(200);
      // 遺失的那張已被取代
      expect(errorCodeOf(await postRefresh(lost))).toBe('AUTH_REFRESH_REVOKED');
      const reuse = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'auth.refresh.reuse_detected'));
      expect(reuse).toEqual([]);
    });

    it('超過寬限期才出示用過的 token → 判定為重用，撤銷整條家族', async () => {
      const { raw } = await loginForCookie();
      const next = refreshCookieOf(await postRefresh(raw).expect(200));
      await db
        .update(refreshTokens)
        .set({ usedAt: new Date(Date.now() - 5 * 60_000) })
        .where(eq(refreshTokens.tokenHash, sha256(raw)));

      expect(errorCodeOf(await postRefresh(raw))).toBe('AUTH_REFRESH_REUSED');
      expect(errorCodeOf(await postRefresh(next))).toBe('AUTH_REFRESH_REVOKED');
    });

    it('寬限期內，但它已經不是上一張（家族之後又續期過）→ 仍判定為重用', async () => {
      const { raw: first } = await loginForCookie();
      const second = refreshCookieOf(await postRefresh(first).expect(200));
      const third = refreshCookieOf(await postRefresh(second).expect(200));

      expect(errorCodeOf(await postRefresh(first))).toBe('AUTH_REFRESH_REUSED');
      expect(errorCodeOf(await postRefresh(third))).toBe('AUTH_REFRESH_REVOKED');
    });
  });

  describe('session 的絕對壽命', () => {
    it('家族建立超過 REFRESH_FAMILY_MAX_AGE → AUTH_REFRESH_EXPIRED，不論期間續期了幾次', async () => {
      const { raw } = await loginForCookie();
      const [row] = await db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, sha256(raw)));
      await db
        .update(refreshTokens)
        .set({ familyCreatedAt: new Date(Date.now() - 31 * DAY_MS) })
        .where(eq(refreshTokens.familyId, row!.familyId));

      expect(errorCodeOf(await postRefresh(raw))).toBe('AUTH_REFRESH_EXPIRED');
    });

    it('快到期的家族：新 token 與 cookie 的壽命截短到家族的絕對壽命', async () => {
      const { raw } = await loginForCookie();
      const [row] = await db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, sha256(raw)));
      const familyCreatedAt = new Date(Date.now() - 30 * DAY_MS + 60_000);
      await db
        .update(refreshTokens)
        .set({ familyCreatedAt })
        .where(eq(refreshTokens.familyId, row!.familyId));

      const response = await postRefresh(raw).expect(200);
      const [next] = await db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, sha256(refreshCookieOf(response))));
      expect(next!.familyCreatedAt).toEqual(familyCreatedAt);
      expect(next!.expiresAt.getTime()).toBeLessThanOrEqual(
        familyCreatedAt.getTime() + 30 * DAY_MS,
      );
      const header = (response.headers['set-cookie'] as unknown as string[]).find((value) =>
        value.startsWith(`${COOKIE_NAME}=`),
      );
      const maxAge = Number(/Max-Age=(\d+)/.exec(header ?? '')?.[1]);
      expect(maxAge).toBeLessThanOrEqual(60);
    });
  });

  it('清理排程刪除過期超過保留期的 token，留下還在期限內的', async () => {
    const [user] = await db.select().from(users).where(eq(users.email, USER.email));
    const old = new Date(Date.now() - 40 * DAY_MS);
    await db.insert(refreshTokens).values([
      { userId: user!.id, familyId: randomUUID(), tokenHash: 'old-1', expiresAt: old },
      {
        userId: user!.id,
        familyId: randomUUID(),
        tokenHash: 'recent-1',
        expiresAt: new Date(Date.now() - DAY_MS),
      },
    ]);
    await db.insert(authTokens).values([
      { userId: user!.id, purpose: 'password_reset', tokenHash: 'old-auth', expiresAt: old },
      {
        userId: user!.id,
        purpose: 'activation',
        tokenHash: 'fresh-auth',
        expiresAt: new Date(Date.now() + DAY_MS),
      },
    ]);

    const result = await inTestTenant(app, () => app.get(AuthTokenCleanupJobs).run());
    expect(result).toEqual({ refreshTokens: 1, authTokens: 1, loginSources: 0 });
    const hashes = (await db.select().from(refreshTokens)).map((row) => row.tokenHash);
    expect(hashes).toContain('recent-1');
    expect(hashes).not.toContain('old-1');
    const remaining = (await db.select().from(authTokens)).map((row) => row.tokenHash);
    expect(remaining).toEqual(['fresh-auth']);
  });

  it('★ 登出與續期同時提交時，漏網的新 token 仍因家族已撤銷而不能續期', async () => {
    const { raw, accessToken } = await loginForCookie();
    const [original] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, sha256(raw)));

    await request(http)
      .post('/auth/logout')
      .set('authorization', `Bearer ${accessToken}`)
      .set('cookie', `${COOKIE_NAME}=${raw}`)
      .expect(200);

    // 模擬續期交易在登出的 revokeFamily 之後才提交：同家族多了一張未撤銷的 token
    const straggler = randomBytes(32).toString('base64url');
    await db.insert(refreshTokens).values({
      userId: original!.userId,
      familyId: original!.familyId,
      tokenHash: sha256(straggler),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const response = await postRefresh(straggler).expect(401);
    expect(errorCodeOf(response)).toBe('AUTH_REFRESH_REVOKED');
  });
});
