import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { AccessTokenVerifier } from '@/common/auth';
import type { AccessTokenKeys } from '@/common/auth';
import { Public, RequirePlatformPermissions } from '@/common/decorators';
import { BroadcastHub } from '@/core/broadcast/__tests__/broadcast-hub';
import { UserCacheService } from '@/core/cache';
import type { Database } from '@/core/database';
import { getRequestContext, runWithRequestContext } from '@/core/http';
import { runInTenantContext } from '@/core/tenant';

import { extractBearer, JwtAuthGuard } from '../jwt-auth.guard';

class TestController {
  @Public()
  open(): void {}

  guarded(): void {}
}

import type { CachedUser } from '@/core/cache';

/** 測試用的租戶脈絡：token 的 `tid` 要與它相符（docs/architecture/05-tenancy.md §10.2 D10）。 */
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
  const keys = {
    verify: vi
      .fn()
      .mockImplementation(async () =>
        options.payload ? { tid: TENANT.id, ...options.payload } : undefined,
      ),
  } as unknown as AccessTokenKeys;
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
    new AccessTokenVerifier(keys, userCache, db, {} as never),
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

class PlatformController {
  @RequirePlatformPermissions('tenant:create')
  createTenant(): void {}
}

function platformContext(authorization?: string) {
  const instance = new PlatformController();
  const request: Record<string, unknown> = { headers: authorization ? { authorization } : {} };
  return {
    context: {
      getType: () => 'http',
      getHandler: () => instance.createTenant as () => void,
      getClass: () => PlatformController,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext,
    request,
  };
}

function fakeVerifierGuard() {
  const verify = vi.fn().mockResolvedValue({
    ok: true,
    user: { id: 'admin-1', email: 'admin@example.com', status: 'active' },
  });
  const guard = new JwtAuthGuard(new Reflector(), { verify } as unknown as AccessTokenVerifier);
  return { guard, verify };
}

describe('JwtAuthGuard：平台管理者的端點（docs/architecture/05-tenancy.md §10.2 D5）', () => {
  it('租戶網域上 → PLATFORM_ONLY，不驗 token', async () => {
    const { guard, verify } = fakeVerifierGuard();
    const { context } = platformContext('Bearer token');
    await expect(
      runWithRequestContext({ requestId: 'r1', platformHost: true }, () =>
        runInTenantContext(TENANT, () => guard.canActivate(context)),
      ),
    ).rejects.toMatchObject({ code: 'PLATFORM_ONLY' });
    expect(verify).not.toHaveBeenCalled();
  });

  it('沒有租戶但不是 apps/platform 的網域（未登記網域、直接用 IP）→ PLATFORM_ONLY', async () => {
    const { guard, verify } = fakeVerifierGuard();
    const { context } = platformContext('Bearer token');
    await expect(
      runWithRequestContext({ requestId: 'r1', platformHost: false }, () =>
        guard.canActivate(context),
      ),
    ).rejects.toMatchObject({ code: 'PLATFORM_ONLY' });
    expect(verify).not.toHaveBeenCalled();
  });

  it('apps/platform 的網域：驗 token 後把管理者放進 request 與請求脈絡', async () => {
    const { guard, verify } = fakeVerifierGuard();
    const { context, request } = platformContext('Bearer platform-token');
    const contextUser = await runWithRequestContext(
      { requestId: 'r1', platformHost: true },
      async () => {
        await expect(guard.canActivate(context)).resolves.toBe(true);
        return getRequestContext()?.user;
      },
    );
    expect(verify).toHaveBeenCalledWith('platform-token');
    expect(request.user).toEqual({ id: 'admin-1', email: 'admin@example.com', status: 'active' });
    expect(contextUser).toEqual({ id: 'admin-1', email: 'admin@example.com' });
  });
});
