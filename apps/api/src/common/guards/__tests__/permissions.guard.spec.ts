import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import {
  Authenticated,
  Public,
  RequireAnyPermission,
  RequirePermissions,
} from '@/common/decorators';
import type { PermissionKey } from '@/common/types';
import { AppException } from '@/core/errors';
import type { AuditService } from '@/modules/audit-log/audit.service';
import type { PermissionService } from '@/modules/permission/permission.service';

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
): { guard: PermissionsGuard; audit: { recordSafely: ReturnType<typeof vi.fn> } } {
  const permissionService = {
    getPermissionSet: vi.fn().mockResolvedValue({
      permissions: new Set(permissions),
      isSuperAdmin,
    }),
  } as unknown as PermissionService;
  const audit = { recordSafely: vi.fn().mockResolvedValue(undefined) };
  return {
    guard: new PermissionsGuard(
      new Reflector(),
      permissionService,
      audit as unknown as AuditService,
    ),
    audit,
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
