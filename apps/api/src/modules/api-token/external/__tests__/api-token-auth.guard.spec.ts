import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Public } from '@/common/decorators';
import type { CachedUser } from '@/core/cache';
import { AppException } from '@/core/errors';
import { runWithRequestContext } from '@/core/http';
import type { RequestContext } from '@/core/http';

import type { ApiTokenUsageService } from '../../api-token-usage.service';
import type { ApiTokenVerifier, ApiTokenVerifyResult } from '../../api-token.verifier';
import { ApiTokenAuthGuard } from '../api-token-auth.guard';
import type { ExternalRequest } from '../api-token-auth.guard';

class TestController {
  @Public()
  health(): void {}

  me(): void {}
}

/** 驗證失敗幾次之後擋下（`EXTERNAL_AUTH_FAILURE_RATE_LIMIT`）。 */
const FAILURE_LIMIT = 2;
const VALID = 'b2bt_valid';

const USER: CachedUser = {
  id: 'user-1',
  email: 'alice@example.com',
  status: 'active',
  tokenVersion: 3,
  deletedAt: null,
};
const SCOPES = new Set(['role:read'] as const);
const EXPIRES_AT = new Date('2026-12-31T00:00:00.000Z');

interface CallOptions {
  method?: keyof TestController;
  authorization?: string;
  ip?: string;
  remoteAddress?: string;
  type?: 'http' | 'ws';
}

const storages: ThrottlerStorageService[] = [];

afterEach(() => {
  for (const storage of storages.splice(0)) storage.onApplicationShutdown();
});

/**
 * fake verifier：`Bearer b2bt_valid` 有效，`Bearer <錯誤碼>` 以那個錯誤碼失敗，其他一律 AUTH_TOKEN_INVALID。
 */
function setup() {
  const storage = new ThrottlerStorageService();
  storages.push(storage);
  const verifier = {
    verify: vi.fn(async (raw: string | undefined): Promise<ApiTokenVerifyResult> => {
      if (raw === VALID) {
        return {
          ok: true,
          user: USER,
          token: { id: 'tok-1', scopes: SCOPES, expiresAt: EXPIRES_AT },
        };
      }
      if (
        raw === 'AUTH_TOKEN_STALE' ||
        raw === 'AUTH_ACCOUNT_DISABLED' ||
        raw === 'AUTH_API_TOKEN_EXPIRED'
      ) {
        return { ok: false, code: raw };
      }
      return { ok: false, code: 'AUTH_TOKEN_INVALID' };
    }),
  };
  const usage = { record: vi.fn((_tokenId: string) => undefined) };
  const config = {
    get: (key: string) => (key === 'EXTERNAL_AUTH_FAILURE_RATE_LIMIT' ? FAILURE_LIMIT : undefined),
  } as unknown as ConfigService<never, true>;
  const guard = new ApiTokenAuthGuard(
    new Reflector(),
    verifier as unknown as ApiTokenVerifier,
    usage as unknown as ApiTokenUsageService,
    storage,
    config,
  );

  const call = async (options: CallOptions = {}) => {
    const request = {
      headers: options.authorization ? { authorization: options.authorization } : {},
      ip: options.ip,
      socket: { remoteAddress: options.remoteAddress },
    } as unknown as ExternalRequest;
    const responseHeaders: Record<string, string> = {};
    const instance = new TestController();
    const context = {
      getType: () => options.type ?? 'http',
      getHandler: () => instance[options.method ?? 'me'] as () => void,
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
    const requestContext: RequestContext = { requestId: 'req-1' };
    const outcome = await runWithRequestContext(requestContext, () =>
      guard.canActivate(context).then(
        (allowed) => ({ allowed, error: undefined }),
        (error: unknown) => {
          if (!(error instanceof AppException)) throw error;
          return { allowed: false, error };
        },
      ),
    );
    return { ...outcome, request, requestContext, headers: responseHeaders };
  };

  return { call, verifier, usage };
}

const bearer = (token: string) => `Bearer ${token}`;

async function repeat(times: number, fn: () => Promise<unknown>): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    // oxlint-disable-next-line no-await-in-loop -- 依序計數
    await fn();
  }
}

describe('ApiTokenAuthGuard 的放行（docs/architecture/06-external-api.md §9.2 D10）', () => {
  it('WebSocket：直接放行，不驗證', async () => {
    const ctx = setup();
    const result = await ctx.call({ type: 'ws' });
    expect(result.allowed).toBe(true);
    expect(ctx.verifier.verify).not.toHaveBeenCalled();
  });

  it('@Public() 的路由（健康檢查）：不驗證、不帶 token 也放行', async () => {
    const ctx = setup();
    const result = await ctx.call({ method: 'health' });
    expect(result.allowed).toBe(true);
    expect(ctx.verifier.verify).not.toHaveBeenCalled();
  });

  it('只讀 Authorization 的 Bearer token 交給 verifier', async () => {
    const ctx = setup();
    await ctx.call({ authorization: bearer(VALID) });
    expect(ctx.verifier.verify).toHaveBeenCalledWith(VALID);
  });

  it('不是 Bearer 的 Authorization：以「沒帶 token」驗證', async () => {
    const ctx = setup();
    await ctx.call({ authorization: `Basic ${VALID}` });
    expect(ctx.verifier.verify).toHaveBeenCalledWith(undefined);
  });
});

describe('ApiTokenAuthGuard 認證成功（docs/architecture/06-external-api.md §9.2 D3、D8）', () => {
  it('放行，req.user 是 token 的帳號、req.apiToken 是 token', async () => {
    const ctx = setup();
    const result = await ctx.call({ authorization: bearer(VALID) });
    expect(result.allowed).toBe(true);
    expect(result.request.user).toEqual({ id: USER.id, email: USER.email, status: 'active' });
    expect(result.request.apiToken).toEqual({ id: 'tok-1', scopes: SCOPES, expiresAt: EXPIRES_AT });
  });

  it('寫進請求脈絡：使用者（稽核用）與 token 的 scopes（權限交集用）', async () => {
    const ctx = setup();
    const result = await ctx.call({ authorization: bearer(VALID) });
    expect(result.requestContext.user).toEqual({ id: USER.id, email: USER.email });
    expect(result.requestContext.apiToken).toEqual({
      id: 'tok-1',
      userId: USER.id,
      scopes: SCOPES,
    });
  });

  it('記下這把 token 用過了（最後使用時間）', async () => {
    const ctx = setup();
    await ctx.call({ authorization: bearer(VALID) });
    expect(ctx.usage.record).toHaveBeenCalledWith('tok-1');
  });
});

describe('ApiTokenAuthGuard 認證失敗（docs/architecture/06-external-api.md §9.2 D5、D7）', () => {
  it.each([
    ['沒帶 token', undefined, 'AUTH_TOKEN_INVALID'],
    ['無效的 token', bearer('garbage'), 'AUTH_TOKEN_INVALID'],
    ['帳號的 token_version 變了', bearer('AUTH_TOKEN_STALE'), 'AUTH_TOKEN_STALE'],
    ['帳號已停用', bearer('AUTH_ACCOUNT_DISABLED'), 'AUTH_ACCOUNT_DISABLED'],
    ['token 已過期', bearer('AUTH_API_TOKEN_EXPIRED'), 'AUTH_API_TOKEN_EXPIRED'],
  ] as const)('%s → %s', async (_label, authorization, code) => {
    const ctx = setup();
    const result = await ctx.call({ authorization });
    expect(result.error?.code).toBe(code);
  });

  it('失敗時不設 req.user、不寫請求脈絡、不記使用', async () => {
    const ctx = setup();
    const result = await ctx.call({ authorization: bearer('garbage') });
    expect(result.request.user).toBeUndefined();
    expect(result.requestContext.user).toBeUndefined();
    expect(result.requestContext.apiToken).toBeUndefined();
    expect(ctx.usage.record).not.toHaveBeenCalled();
  });
});

describe('ApiTokenAuthGuard 的驗證失敗限流（docs/architecture/06-external-api.md §9.2 D13）', () => {
  it(`同一個 IP 失敗 ${FAILURE_LIMIT} 次之後 → RATE_LIMITED，帶 Retry-After`, async () => {
    const ctx = setup();
    await repeat(FAILURE_LIMIT, () => ctx.call({ ip: '203.0.113.10' }));
    const blocked = await ctx.call({ ip: '203.0.113.10' });
    expect(blocked.error?.code).toBe('RATE_LIMITED');
    const seconds = blocked.error?.details?.retryAfterSeconds;
    expect(seconds).toBeGreaterThanOrEqual(1);
    expect(blocked.headers['Retry-After']).toBe(String(seconds));
  });

  it(`前 ${FAILURE_LIMIT} 次失敗仍回原本的錯誤碼`, async () => {
    const ctx = setup();
    await ctx.call({ ip: '203.0.113.10' });
    const second = await ctx.call({ ip: '203.0.113.10' });
    expect(second.error?.code).toBe('AUTH_TOKEN_INVALID');
  });

  it('其他 IP 不受影響', async () => {
    const ctx = setup();
    await repeat(FAILURE_LIMIT + 1, () => ctx.call({ ip: '203.0.113.10' }));
    const other = await ctx.call({ ip: '198.51.100.7' });
    expect(other.error?.code).toBe('AUTH_TOKEN_INVALID');
  });

  it('成功的請求不計入失敗的桶', async () => {
    const ctx = setup();
    await ctx.call({ ip: '203.0.113.10' });
    await repeat(5, () => ctx.call({ ip: '203.0.113.10', authorization: bearer(VALID) }));
    const second = await ctx.call({ ip: '203.0.113.10' });
    expect(second.error?.code).toBe('AUTH_TOKEN_INVALID');
  });

  it('被擋之後，同一個 IP 帶有效的 token 仍可通過（只擋失敗）', async () => {
    const ctx = setup();
    await repeat(FAILURE_LIMIT + 1, () => ctx.call({ ip: '203.0.113.10' }));
    const valid = await ctx.call({ ip: '203.0.113.10', authorization: bearer(VALID) });
    expect(valid.allowed).toBe(true);
  });

  it('沒有 req.ip 時以連線的位址計數', async () => {
    const ctx = setup();
    await repeat(FAILURE_LIMIT, () => ctx.call({ remoteAddress: '192.0.2.1' }));
    expect((await ctx.call({ remoteAddress: '192.0.2.1' })).error?.code).toBe('RATE_LIMITED');
    expect((await ctx.call({ remoteAddress: '192.0.2.2' })).error?.code).toBe('AUTH_TOKEN_INVALID');
  });
});
