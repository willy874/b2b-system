import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import { describe, expect, it, vi } from 'vitest';

import { AccessTokenVerifier } from '@/common/auth';
import { Public } from '@/common/decorators';
import { BroadcastHub } from '@/core/broadcast/__tests__/broadcast-hub';
import { UserCacheService } from '@/core/cache';
import type { Database } from '@/core/database';
import { runInTenantContext } from '@/core/tenant';

import { extractBearer, JwtAuthGuard } from '../jwt-auth.guard';

class TestController {
  @Public()
  open(): void {}

  guarded(): void {}
}

import type { CachedUser } from '@/core/cache';

/** 測試用的租戶脈絡：token 的 `tid` 要與它相符（docs/adr/0020-physical-tenant-isolation.md D10）。 */
const TENANT = {
  id: 'tenant-1',
  code: 'test',
  db: {} as Database,
  storageBucket: 'b2b-test',
  features: ['file', 'auditLog', 'job'] as const,
  flags: {},
  featureParams: {},
};

const activeUser: CachedUser = {
  id: 'user-1',
  email: 'a@example.com',
  status: 'active',
  tokenVersion: 0,
  deletedAt: null,
};

function createContext(method: keyof TestController, authorization?: string) {
  const instance = new TestController();
  const request: Record<string, unknown> = { headers: authorization ? { authorization } : {} };
  return {
    context: {
      getType: () => 'http',
      getHandler: () => instance[method] as () => void,
      getClass: () => TestController,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext,
    request,
  };
}

function createGuard(
  options: {
    payload?: { sub: string; ver: number; jti: string; tid?: string };
    cached?: typeof activeUser;
    dbUser?: Partial<typeof activeUser>;
  } = {},
) {
  const jwt = {
    verifyAsync: vi
      .fn()
      .mockImplementation(() =>
        options.payload
          ? Promise.resolve({ tid: TENANT.id, ...options.payload })
          : Promise.reject(new Error('invalid signature')),
      ),
  } as unknown as JwtService;

  const config = { get: () => 'secret' } as unknown as ConfigService<never, true>;
  const userCache = new UserCacheService(new BroadcastHub().instance());
  const { cached } = options;
  if (cached) runInTenantContext(TENANT, () => userCache.set(cached));

  const rows = options.dbUser ? [{ ...activeUser, ...options.dbUser }] : [];
  const db = {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
    }),
  } as unknown as Database;

  const guard = new JwtAuthGuard(
    new Reflector(),
    new AccessTokenVerifier(jwt, config as never, userCache, db, {} as never),
  );
  // 請求都在某個租戶裡（TenantMiddleware）
  return {
    canActivate: (context: ExecutionContext) =>
      runInTenantContext(TENANT, () => guard.canActivate(context)),
  };
}

describe('extractBearer', () => {
  it('取出 Bearer token', () => {
    expect(extractBearer('Bearer abc')).toBe('abc');
  });

  it('格式不符回 undefined', () => {
    expect(extractBearer('Basic abc')).toBeUndefined();
    expect(extractBearer(undefined)).toBeUndefined();
    expect(extractBearer('Bearer   ')).toBeUndefined();
  });
});

describe('JwtAuthGuard', () => {
  it('@Public 直接放行', async () => {
    const { context } = createContext('open');
    await expect(createGuard().canActivate(context)).resolves.toBe(true);
  });

  it('沒有 Authorization 標頭 → AUTH_TOKEN_INVALID', async () => {
    const { context } = createContext('guarded');
    await expect(createGuard().canActivate(context)).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
  });

  it('驗簽失敗 → AUTH_TOKEN_INVALID', async () => {
    const { context } = createContext('guarded', 'Bearer bad-token');
    await expect(createGuard().canActivate(context)).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
  });

  it('token 是別的租戶簽的 → AUTH_TOKEN_INVALID（不查使用者）', async () => {
    const { context } = createContext('guarded', 'Bearer token');
    const guard = createGuard({
      payload: { sub: 'user-1', ver: 0, jti: 'jti', tid: 'tenant-2' },
      cached: activeUser,
    });
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
  });

  it('使用者不存在 → AUTH_TOKEN_INVALID', async () => {
    const { context } = createContext('guarded', 'Bearer token');
    const guard = createGuard({ payload: { sub: 'user-1', ver: 0, jti: 'jti' } });
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
  });

  it('使用者已軟刪除 → AUTH_TOKEN_INVALID', async () => {
    const { context } = createContext('guarded', 'Bearer token');
    const guard = createGuard({
      payload: { sub: 'user-1', ver: 0, jti: 'jti' },
      dbUser: { deletedAt: new Date() },
    });
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
  });

  it('使用者被停用 → AUTH_ACCOUNT_DISABLED', async () => {
    const { context } = createContext('guarded', 'Bearer token');
    const guard = createGuard({
      payload: { sub: 'user-1', ver: 0, jti: 'jti' },
      dbUser: { status: 'inactive' },
    });
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: 'AUTH_ACCOUNT_DISABLED',
    });
  });

  it('token_version 不符 → AUTH_TOKEN_STALE（管理端終止了這個 session）', async () => {
    const { context } = createContext('guarded', 'Bearer token');
    const guard = createGuard({
      payload: { sub: 'user-1', ver: 0, jti: 'jti' },
      dbUser: { tokenVersion: 1 },
    });
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: 'AUTH_TOKEN_STALE',
    });
  });

  it('成功時把使用者放進 request', async () => {
    const { context, request } = createContext('guarded', 'Bearer token');
    const guard = createGuard({
      payload: { sub: 'user-1', ver: 0, jti: 'jti' },
      dbUser: {},
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'user-1', email: 'a@example.com', status: 'active' });
  });

  it('命中 UserCache 時不查資料庫', async () => {
    const { context } = createContext('guarded', 'Bearer token');
    const guard = createGuard({
      payload: { sub: 'user-1', ver: 0, jti: 'jti' },
      cached: activeUser,
      // 沒有 dbUser：若查了 DB 就會因為找不到而失敗
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('非 HTTP 的執行環境直接放行（例如排程）', async () => {
    const context = { getType: () => 'rpc' } as unknown as ExecutionContext;
    await expect(createGuard().canActivate(context)).resolves.toBe(true);
  });
});
