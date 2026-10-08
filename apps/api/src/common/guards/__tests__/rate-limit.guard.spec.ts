import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { SkipThrottle } from '@nestjs/throttler';
import { afterEach, describe, expect, it } from 'vitest';

import type { AccessTokenVerifier } from '@/common/auth';
import { RateLimit } from '@/common/rate-limit';
import type { Database } from '@/core/database';
import { AppException } from '@/core/errors';
import { MemoryRateLimitStore } from '@/core/rate-limit';
import type { RateLimitStore } from '@/core/rate-limit';
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
  RATE_LIMIT_EXEMPT_CIDRS: '10.0.0.0/8',
};

const tenantOf = (id: string) => ({
  id,
  code: id,
  db: {} as Database,
  storageBucket: `b2b-${id}`,
  features: ['file', 'auditLog', 'job'] as const,
  flags: {},
  featureParams: {},
});

interface FakeRequest {
  ip: string | undefined;
  headers: Record<string, string>;
  body?: unknown;
  cookies?: Record<string, string>;
  socket: { remoteAddress?: string };
}

interface CallOptions {
  /** `null`：req.ip 沒有值（改看 socket.remoteAddress）。 */
  ip?: string | null;
  remoteAddress?: string;
  /** Bearer token；fake verifier 把 `user:<id>` 當成有效的 token。 */
  token?: string;
  body?: unknown;
  cookie?: string;
  type?: 'http' | 'ws';
}

const storages: MemoryRateLimitStore[] = [];

function createGuard(store?: RateLimitStore) {
  const storage = new MemoryRateLimitStore();
  storages.push(storage);
  const verifier = {
    verifyClaims: (token: string | undefined) =>
      Promise.resolve(token?.startsWith('user:') ? { sub: token.slice(5) } : undefined),
  } as unknown as AccessTokenVerifier;
  const config = { get: (key: string) => LIMITS[key] } as unknown as ConfigService<never, true>;
  const guard = new RateLimitGuard(store ?? storage, new Reflector(), verifier, config);

  return async (method: keyof TestController, options: CallOptions = {}) => {
    const headers: Record<string, string> = {};
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    const request: FakeRequest = {
      ip: options.ip === null ? undefined : (options.ip ?? '203.0.113.10'),
      headers,
      body: options.body,
      cookies: options.cookie ? { refresh_token: options.cookie } : {},
      socket: { remoteAddress: options.remoteAddress },
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
  for (const storage of storages.splice(0)) storage.onModuleDestroy();
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

  it('豁免的網段（RATE_LIMIT_EXEMPT_CIDRS）只略過 IP 桶：帳號的桶照常計', async () => {
    const call = createGuard();
    const anonymous = await repeat(5, () => call('list', { ip: '10.1.2.3' }));
    expect(anonymous.every((result) => result.status === 200)).toBe(true);

    const login = () => call('login', { ip: '10.1.2.3', body: { email: 'a@example.com' } });
    await repeat(2, login);
    expect((await login()).status).toBe(429);
  });

  it('租戶的白名單（rateLimit.trustedCidrs）：登入的 IP 桶 ×10，其他來源不變', async () => {
    const call = createGuard();
    const tenant = {
      ...tenantOf('acme'),
      featureParams: { 'rateLimit.trustedCidrs': '198.51.100.0/24' },
    };
    const login = (ip: string) =>
      runInTenantContext(tenant, () =>
        call('login', { ip, body: { email: `user${Math.random()}@example.com` } }),
      );
    const trusted = await repeat(10, () => login('198.51.100.7'));
    expect(trusted.every((result) => result.status === 200)).toBe(true);
    const others = await repeat(5, () => login('203.0.113.99'));
    expect(others.map((result) => result.status)).toEqual([200, 200, 200, 200, 429]);
  });

  describe('計數存不了時（docs/architecture/01-system.md §7 D6）', () => {
    const failing = {
      hit: () => Promise.reject(new Error('platform db down')),
      peek: () => Promise.reject(new Error('platform db down')),
      reset: () => Promise.reject(new Error('platform db down')),
    } as unknown as RateLimitStore;

    it('一般請求放行', async () => {
      const call = createGuard(failing);
      expect((await call('list', { token: 'user:alice' })).status).toBe(200);
      expect((await call('list')).status).toBe(200);
    });

    it('登入類拒絕：AUTH_BUSY ＋ retryAfterSeconds（前端照常倒數）', async () => {
      const call = createGuard(failing);
      const login = await call('login', { body: { email: 'a@example.com' } });
      expect(login.error?.code).toBe('AUTH_BUSY');
      expect(login.error?.details?.retryAfterSeconds).toBeGreaterThan(0);
      expect((await call('refresh', { cookie: 'session-1' })).error?.code).toBe('AUTH_BUSY');
    });
  });
});

describe('RateLimitGuard：其餘分支', () => {
  it('req.ip 沒有值時以 socket.remoteAddress 計', async () => {
    const call = createGuard();
    const anonymous = () => call('list', { ip: null, remoteAddress: '192.0.2.1' });
    await repeat(2, anonymous);
    expect((await anonymous()).status).toBe(429);
    expect((await call('list', { ip: null, remoteAddress: '192.0.2.2' })).status).toBe(200);
  });

  it('租戶覆寫 rateLimit.authPerMinute 時，租戶的登入合計以覆寫值為上限', async () => {
    const call = createGuard();
    const tenant = { ...tenantOf('acme'), featureParams: { 'rateLimit.authPerMinute': 60 } };
    // 每次換 IP 與帳號：只有租戶桶會累積
    const login = (index: number) =>
      runInTenantContext(tenant, () =>
        call('login', { ip: `198.18.0.${index}`, body: { email: `u${index}@example.com` } }),
      );
    const results: number[] = [];
    for (let index = 1; index <= 61; index += 1) {
      // oxlint-disable-next-line no-await-in-loop -- 依序計數
      results.push((await login(index)).status);
    }
    expect(results.slice(0, 60).every((status) => status === 200)).toBe(true);
    expect(results[60]).toBe(429);
  });

  it('已登入、body 沒有 email 的帳號類端點（改密碼）以身分計，換 IP 也一樣受限', async () => {
    const call = createGuard();
    const change = (ip: string) => call('login', { ip, token: 'user:alice', body: {} });
    await change('203.0.113.1');
    await change('203.0.113.2');
    expect((await change('203.0.113.3')).status).toBe(429);
    // 另一個身分不受影響
    expect((await call('login', { ip: '203.0.113.4', token: 'user:bob', body: {} })).status).toBe(
      200,
    );
  });

  it('帳號類端點在租戶裡以「租戶＋身分」計', async () => {
    const call = createGuard();
    const change = (tenantId: string, ip: string) =>
      runInTenantContext(tenantOf(tenantId), () =>
        call('login', { ip, token: 'user:same-id', body: {} }),
      );
    await change('acme', '203.0.113.1');
    await change('acme', '203.0.113.2');
    expect((await change('acme', '203.0.113.3')).status).toBe(429);
    expect((await change('beta', '203.0.113.4')).status).toBe(200);
  });

  it('續期沒有 refresh cookie 時只計 IP 桶', async () => {
    const call = createGuard();
    const results = await repeat(5, () => call('refresh'));
    expect(results.map((result) => result.status)).toEqual([200, 200, 200, 200, 429]);
  });
});
