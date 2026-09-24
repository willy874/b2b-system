import { randomBytes } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { Response } from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { refreshTokens, users } from '@/db/schema';
import { sha256 } from '@/modules/auth/token-hash';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;

const COOKIE_NAME = 'refresh_token';
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
    process.env.DATABASE_URL = inject('databaseUrl');
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = 'root@example.com';
    process.env.SUPER_ADMIN_PASSWORD = 'RootPassword!2026';

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);

    const { hashPassword } = await import('@/modules/auth/password');
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
    http = app.getHttpServer() as App;
  });

  beforeEach(async () => {
    await db.delete(refreshTokens);
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

  it('★ 同一張 refresh token 的併發請求只有一個成功，其餘判定為重用', async () => {
    const { raw } = await loginForCookie();

    const responses = await Promise.all(Array.from({ length: 5 }, () => postRefresh(raw)));

    const succeeded = responses.filter((response) => response.status === 200);
    expect(succeeded).toHaveLength(1);
    for (const response of responses.filter((r) => r.status !== 200)) {
      expect(response.status).toBe(401);
      expect(errorCodeOf(response)).toBe('AUTH_REFRESH_REUSED');
    }
    // 重用偵測撤銷整條家族：搶到的那一個拿到的新 token 也不能用，家族不會分岔
    const issued = await db.select().from(refreshTokens);
    expect(issued.filter((row) => row.revokedAt === null)).toHaveLength(0);
    const winner = await postRefresh(refreshCookieOf(succeeded[0]!));
    expect(errorCodeOf(winner)).toBe('AUTH_REFRESH_REVOKED');
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
