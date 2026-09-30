import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { SkipThrottle, ThrottlerStorageService } from '@nestjs/throttler';
import { afterEach, describe, expect, it } from 'vitest';

import type { AccessTokenVerifier } from '@/common/auth';
import { RateLimit } from '@/common/rate-limit';
import type { Database } from '@/core/database';
import { AppException } from '@/core/errors';
import { runInTenantContext } from '@/core/tenant';

import { RateLimitGuard } from '../rate-limit.guard';

class TestController {
  list(): void {}

  @RateLimit('auth')
  login(): void {}

  @RateLimit('refresh')
  refresh(): void {}

  @SkipThrottle()
  image(): void {}
}

const LIMITS: Record<string, number | string> = {
  DEFAULT_RATE_LIMIT: 3,
  ANONYMOUS_RATE_LIMIT: 2,
  AUTH_RATE_LIMIT: 2,
  AUTH_IP_RATE_LIMIT: 4,
  REFRESH_RATE_LIMIT: 2,
  REFRESH_IP_RATE_LIMIT: 4,
  REFRESH_COOKIE_NAME: 'refresh_token',
};

const tenantOf = (id: string) => ({
  id,
  code: id,
  db: {} as Database,
  storageBucket: `b2b-${id}`,
  allowExternalIdp: true,
  features: ['file', 'auditLog', 'job'] as const,
  flags: {},
});

interface FakeRequest {
  ip: string;
  headers: Record<string, string>;
  body?: unknown;
  cookies?: Record<string, string>;
  socket: { remoteAddress?: string };
}

interface CallOptions {
  ip?: string;
  /** Bearer token；fake verifier 把 `user:<id>` 當成有效的 token。 */
  token?: string;
  body?: unknown;
  cookie?: string;
  type?: 'http' | 'ws';
}

const storages: ThrottlerStorageService[] = [];

function createGuard() {
  const storage = new ThrottlerStorageService();
  storages.push(storage);
  const verifier = {
    verifyClaims: (token: string | undefined) =>
      Promise.resolve(token?.startsWith('user:') ? { sub: token.slice(5) } : undefined),
  } as unknown as AccessTokenVerifier;
  const config = { get: (key: string) => LIMITS[key] } as unknown as ConfigService<never, true>;
  const guard = new RateLimitGuard(storage, new Reflector(), verifier, config);

  return async (method: keyof TestController, options: CallOptions = {}) => {
    const headers: Record<string, string> = {};
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    const request: FakeRequest = {
      ip: options.ip ?? '203.0.113.10',
      headers,
      body: options.body,
      cookies: options.cookie ? { refresh_token: options.cookie } : {},
      socket: {},
    };
    const responseHeaders: Record<string, string> = {};
    const instance = new TestController();
    const context = {
      getType: () => options.type ?? 'http',
      getHandler: () => instance[method] as () => void,
      getClass: () => TestController,
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({
          setHeader: (name: string, value: string) => {
            responseHeaders[name] = value;
          },
        }),
      }),
    } as unknown as ExecutionContext;
    try {
      await guard.canActivate(context);
      return { status: 200, headers: responseHeaders, error: undefined };
    } catch (error) {
      if (!(error instanceof AppException)) throw error;
      return { status: 429, headers: responseHeaders, error };
    }
  };
}

async function repeat<T>(times: number, call: () => Promise<T>): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < times; i += 1) {
    // oxlint-disable-next-line no-await-in-loop -- 依序計數
    results.push(await call());
  }
  return results;
}

afterEach(() => {
  for (const storage of storages.splice(0)) storage.onApplicationShutdown();
});

describe('RateLimitGuard（docs/architecture/backend/03-api-conventions.md §8）', () => {
  it('已登入的請求以使用者計：同一個 IP 的兩個使用者各自有完整的額度', async () => {
    const call = createGuard();
    const alice = await repeat(3, () => call('list', { token: 'user:alice' }));
    expect(alice.map((result) => result.status)).toEqual([200, 200, 200]);
    expect((await call('list', { token: 'user:alice' })).status).toBe(429);

    expect((await call('list', { token: 'user:bob' })).status).toBe(200);
  });

  it('使用者的 key 帶租戶：兩個租戶裡同一個 id 不共用額度', async () => {
    const call = createGuard();
    const inTenant = (id: string) =>
      runInTenantContext(tenantOf(id), () => call('list', { token: 'user:same-id' }));
    await repeat(3, () => inTenant('acme'));
    expect((await inTenant('acme')).status).toBe(429);
    expect((await inTenant('beta')).status).toBe(200);
  });

  it('未登入（或 token 無效）以 IP 計', async () => {
    const call = createGuard();
    await repeat(2, () => call('list', { token: 'garbage' }));
    expect((await call('list')).status).toBe(429);
    expect((await call('list', { ip: '198.51.100.7' })).status).toBe(200);
  });

  it('超過上限回 RATE_LIMITED，帶 Retry-After 標頭與 details.retryAfterSeconds', async () => {
    const call = createGuard();
    await repeat(2, () => call('list'));
    const blocked = await call('list');
    expect(blocked.error?.code).toBe('RATE_LIMITED');
    const seconds = blocked.error?.details?.retryAfterSeconds;
    expect(seconds).toBeGreaterThanOrEqual(1);
    expect(seconds).toBeLessThanOrEqual(60);
    expect(blocked.headers['Retry-After']).toBe(String(seconds));
  });

  it('登入類端點以「帳號 ＋ IP」計：同帳號被擋時，同一個 IP 的其他帳號仍可登入', async () => {
    const call = createGuard();
    const login = (email: string) => call('login', { body: { email, password: 'x' } });
    await repeat(2, () => login('Alice@Example.com '));
    // email 正規化（大小寫、空白）後是同一個帳號
    expect((await login('alice@example.com')).status).toBe(429);
    expect((await login('bob@example.com')).status).toBe(200);
  });

  it('登入類端點的 IP 桶：同一個 IP 換帳號也有總上限', async () => {
    const call = createGuard();
    const results = await repeat(5, () =>
      call('login', { body: { email: `user${Math.random()}@example.com` } }),
    );
    expect(results.map((result) => result.status)).toEqual([200, 200, 200, 200, 429]);
  });

  it('續期以 refresh session 計：同一個 IP 的不同 session 各自計數', async () => {
    const call = createGuard();
    await repeat(2, () => call('refresh', { cookie: 'session-a' }));
    expect((await call('refresh', { cookie: 'session-a' })).status).toBe(429);
    // 被擋的那次也計入 IP 桶（4）：還剩一次
    expect((await call('refresh', { cookie: 'session-b' })).status).toBe(200);
    expect((await call('refresh', { cookie: 'session-c' })).status).toBe(429);
  });

  it('@SkipThrottle() 的端點與 WebSocket 不計數', async () => {
    const call = createGuard();
    const results = await repeat(5, () => call('image'));
    expect(results.every((result) => result.status === 200)).toBe(true);
    const ws = await repeat(5, () => call('list', { type: 'ws' }));
    expect(ws.every((result) => result.status === 200)).toBe(true);
  });
});
