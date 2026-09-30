import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WsException } from '@nestjs/websockets';
import { describe, expect, it, vi } from 'vitest';

import {
  Authenticated,
  Public,
  RequireAnyPermission,
  RequirePermissions,
  RequirePlatformPermissions,
} from '@/common/decorators';
import type { PermissionKey, PlatformPermissionKey } from '@/common/types';
import { AppException } from '@/core/errors';
import { runInTenantContext } from '@/core/tenant';
import type { TenantContext } from '@/core/tenant';
import type { AuditService } from '@/modules/audit-log/audit.service';
import type { PermissionService } from '@/modules/permission/permission.service';
import type { PlatformAdminService } from '@/modules/platform-admin/platform-admin.service';
import type { PlatformAuditService } from '@/modules/platform-admin/platform-audit.service';

import { PermissionsGuard } from '../permissions.guard';

class TestController {
  @Public()
  publicRoute(): void {}

  @Authenticated()
  authenticatedRoute(): void {}

  @RequirePermissions('role:update')
  updateRole(): void {}

  @RequirePermissions('role:read', 'permission:read')
  listRolePermissions(): void {}

  @RequireAnyPermission('role:read', 'user:read')
  someRoute(): void {}

  @RequirePlatformPermissions('tenant:create')
  createTenant(): void {}

  undeclaredRoute(): void {}
}

function createContext(method: keyof TestController): ExecutionContext {
  const instance = new TestController();
  const handler = instance[method] as () => void;
  return {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => TestController,
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'GET',
        path: '/test',
        route: { path: '/test' },
        user: { id: 'user-1', email: 'a@example.com', status: 'active' },
      }),
    }),
  } as unknown as ExecutionContext;
}

function createGuard(
  permissions: PermissionKey[],
  isSuperAdmin = false,
  platformPermissions: PlatformPermissionKey[] = [],
): {
  guard: PermissionsGuard;
  audit: { recordSafely: ReturnType<typeof vi.fn> };
  platformAudit: { recordSafely: ReturnType<typeof vi.fn> };
} {
  const permissionService = {
    getPermissionSet: vi.fn().mockResolvedValue({
      permissions: new Set(permissions),
      isSuperAdmin,
    }),
  } as unknown as PermissionService;
  const audit = { recordSafely: vi.fn().mockResolvedValue(undefined) };
  const platformAudit = { recordSafely: vi.fn().mockResolvedValue(undefined) };
  const platformAdmins = {
    permissionsOf: vi.fn().mockResolvedValue(new Set(platformPermissions)),
  } as unknown as PlatformAdminService;
  return {
    guard: new PermissionsGuard(
      new Reflector(),
      permissionService,
      audit as unknown as AuditService,
      platformAdmins,
      platformAudit as unknown as PlatformAuditService,
    ),
    audit,
    platformAudit,
  };
}

describe('PermissionsGuard', () => {
  it('@Public 直接放行', async () => {
    const { guard } = createGuard([]);
    await expect(guard.canActivate(createContext('publicRoute'))).resolves.toBe(true);
  });

  it('@Authenticated 不檢查權限', async () => {
    const { guard } = createGuard([]);
    await expect(guard.canActivate(createContext('authenticatedRoute'))).resolves.toBe(true);
  });

  it('★ 沒有任何宣告 = 啟動期漏網的程式錯誤 → ROUTE_PERMISSION_NOT_DECLARED', async () => {
    const { guard } = createGuard(['role:update']);
    await expect(guard.canActivate(createContext('undeclaredRoute'))).rejects.toMatchObject({
      code: 'ROUTE_PERMISSION_NOT_DECLARED',
    });
  });

  it('持有所需權限時放行', async () => {
    const { guard } = createGuard(['role:update']);
    await expect(guard.canActivate(createContext('updateRole'))).resolves.toBe(true);
  });

  it('EVERY：缺其中一個就拒絕，並回報缺哪一個', async () => {
    const { guard } = createGuard(['role:read']);
    await expect(guard.canActivate(createContext('listRolePermissions'))).rejects.toMatchObject({
      code: 'AUTHZ_FORBIDDEN',
      details: { required: ['role:read', 'permission:read'], missing: ['permission:read'] },
    });
  });

  it('SOME：持有其中一個即可', async () => {
    const { guard } = createGuard(['user:read']);
    await expect(guard.canActivate(createContext('someRoute'))).resolves.toBe(true);
  });

  it('super-admin 繞過所有檢查', async () => {
    const { guard } = createGuard([], true);
    await expect(guard.canActivate(createContext('updateRole'))).resolves.toBe(true);
  });

  it('每一次拒絕都寫入 authz.denied 稽核', async () => {
    const { guard, audit } = createGuard([]);
    await expect(guard.canActivate(createContext('updateRole'))).rejects.toBeInstanceOf(
      AppException,
    );
    expect(audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'authz.denied',
        result: 'failure',
        errorCode: 'AUTHZ_FORBIDDEN',
        metadata: expect.objectContaining({ required: ['role:update'], missing: ['role:update'] }),
      }),
    );
  });

  it('未認證（沒有 req.user）時拒絕', async () => {
    const { guard } = createGuard([]);
    const context = {
      getType: () => 'http',
      getHandler: () => new TestController().updateRole,
      getClass: () => TestController,
      switchToHttp: () => ({
        getRequest: () => ({ method: 'GET', path: '/test', route: { path: '/test' } }),
      }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'AUTH_TOKEN_INVALID' });
  });
});

describe('PermissionsGuard：平台管理者的端點（docs/adr/0020-physical-tenant-isolation.md D5）', () => {
  const tenant = {
    id: 't1',
    code: 'acme',
    db: {},
    storageBucket: 'b',
    allowExternalIdp: true,
  } as unknown as TenantContext;

  it('持有平台權限時放行（不查租戶的權限）', async () => {
    const { guard } = createGuard([], true, ['tenant:create']);
    await expect(guard.canActivate(createContext('createTenant'))).resolves.toBe(true);
  });

  it('缺平台權限 → AUTHZ_FORBIDDEN，寫平台稽核（不寫租戶稽核）', async () => {
    const { guard, audit, platformAudit } = createGuard([], true, ['tenant:read']);
    await expect(guard.canActivate(createContext('createTenant'))).rejects.toMatchObject({
      code: 'AUTHZ_FORBIDDEN',
      details: { missing: ['tenant:create'] },
    });
    expect(platformAudit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'authz.denied', errorCode: 'AUTHZ_FORBIDDEN' }),
    );
    expect(audit.recordSafely).not.toHaveBeenCalled();
  });

  it('租戶網域上 → PLATFORM_ONLY（租戶的 super-admin 也一樣）', async () => {
    const { guard } = createGuard([], true, ['tenant:create']);
    await expect(
      runInTenantContext(tenant, () => guard.canActivate(createContext('createTenant'))),
    ).rejects.toMatchObject({ code: 'PLATFORM_ONLY' });
  });

  it('租戶的權限端點不看平台權限', async () => {
    const { guard } = createGuard([], false, ['tenant:create']);
    await expect(guard.canActivate(createContext('updateRole'))).rejects.toMatchObject({
      code: 'AUTHZ_FORBIDDEN',
    });
  });
});

function createWsContext(method: keyof TestController, data: Record<string, unknown>) {
  const instance = new TestController();
  return {
    getType: () => 'ws',
    getHandler: () => instance[method] as () => void,
    getClass: () => TestController,
    switchToWs: () => ({ getClient: () => ({ id: 's1', data }) }),
  } as unknown as ExecutionContext;
}

const socketIdentity = {
  userId: 'user-1',
  email: 'a@example.com',
  tokenVersion: 0,
  expiresAt: Date.now() + 60_000,
};

describe('PermissionsGuard（WebSocket，docs/architecture/backend/08-realtime.md §4）', () => {
  it('@Authenticated 放行', async () => {
    const { guard } = createGuard([]);
    await expect(
      guard.canActivate(createWsContext('authenticatedRoute', socketIdentity)),
    ).resolves.toBe(true);
  });

  it('從 socket.data.userId 解析權限，持有即放行', async () => {
    const { guard } = createGuard(['role:update']);
    await expect(guard.canActivate(createWsContext('updateRole', socketIdentity))).resolves.toBe(
      true,
    );
  });

  it('缺權限 → WsException（帶 code）並寫稽核', async () => {
    const { guard, audit } = createGuard([]);
    const error = await guard
      .canActivate(createWsContext('updateRole', socketIdentity))
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WsException);
    expect((error as WsException).getError()).toMatchObject({ code: 'AUTHZ_FORBIDDEN' });
    expect(audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'user-1', action: 'authz.denied' }),
    );
  });

  it('沒有宣告 → ROUTE_PERMISSION_NOT_DECLARED', async () => {
    const { guard } = createGuard(['role:update']);
    const error = await guard
      .canActivate(createWsContext('undeclaredRoute', socketIdentity))
      .catch((caught: unknown) => caught);
    expect((error as WsException).getError()).toMatchObject({
      code: 'ROUTE_PERMISSION_NOT_DECLARED',
    });
  });

  it('socket 上沒有身分 → AUTH_TOKEN_INVALID', async () => {
    const { guard } = createGuard(['role:update']);
    const error = await guard
      .canActivate(createWsContext('updateRole', {}))
      .catch((caught: unknown) => caught);
    expect((error as WsException).getError()).toMatchObject({ code: 'AUTH_TOKEN_INVALID' });
  });
});
