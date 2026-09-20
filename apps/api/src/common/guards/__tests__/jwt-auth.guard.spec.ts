import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import { describe, expect, it, vi } from 'vitest';

import { Public } from '@/common/decorators';
import { UserCacheService } from '@/core/cache';
import type { Database } from '@/core/database';

import { extractBearer, JwtAuthGuard } from '../jwt-auth.guard';

class TestController {
  @Public()
  open(): void {}

  guarded(): void {}
}

import type { CachedUser } from '@/core/cache';

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
    payload?: { sub: string; ver: number; jti: string };
    cached?: typeof activeUser;
    dbUser?: Partial<typeof activeUser>;
  } = {},
) {
  const jwt = {
    verifyAsync: vi
      .fn()
      .mockImplementation(() =>
        options.payload
          ? Promise.resolve(options.payload)
          : Promise.reject(new Error('invalid signature')),
      ),
  } as unknown as JwtService;

  const config = { get: () => 'secret' } as unknown as ConfigService<never, true>;
  const userCache = new UserCacheService();
  if (options.cached) userCache.set(options.cached);

  const rows = options.dbUser ? [{ ...activeUser, ...options.dbUser }] : [];
  const db = {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
    }),
  } as unknown as Database;

  return new JwtAuthGuard(new Reflector(), jwt, config as never, userCache, db);
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
