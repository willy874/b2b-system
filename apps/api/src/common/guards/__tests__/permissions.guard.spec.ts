import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WsException } from '@nestjs/websockets';
import { describe, expect, it, vi } from 'vitest';

import {
  Authenticated,
  Public,
  RequireAnyPermission,
  RequirePermissions,
  WorkspaceScoped,
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

@WorkspaceScoped()
class WorkspaceController {
  @Authenticated()
  me(): void {}

  @RequirePermissions('file:read')
  listFiles(): void {}
}

const WORKSPACE_ID = '99999999-9999-4999-8999-999999999999';

function createWorkspaceContext(method: keyof WorkspaceController, workspaceId = WORKSPACE_ID) {
  const instance = new WorkspaceController();
  const req: Record<string, unknown> = {
    method: 'GET',
    path: `/workspaces/${workspaceId}/files`,
    route: { path: '/workspaces/:workspaceId/files' },
    params: { workspaceId },
    user: { id: 'user-1', email: 'a@example.com', status: 'active' },
  };
  const context = {
    getType: () => 'http',
    getHandler: () => instance[method] as () => void,
    getClass: () => WorkspaceController,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { context, req };
}

function createWorkspaceGuard(set: {
  permissions: PermissionKey[];
  canEnter: boolean;
  isSuperAdmin?: boolean;
}) {
  const permissionService = {
    getPermissionSet: vi.fn(),
    getWorkspacePermissionSet: vi.fn().mockResolvedValue({
      permissions: new Set(set.permissions),
      isSuperAdmin: set.isSuperAdmin ?? false,
      canEnter: set.canEnter,
    }),
  };
  const audit = { recordSafely: vi.fn().mockResolvedValue(undefined) };
  const guard = new PermissionsGuard(
    new Reflector(),
    permissionService as unknown as PermissionService,
    audit as unknown as AuditService,
  );
  return { guard, permissionService };
}

describe('PermissionsGuard（工作區範圍，docs/adr/0018-workspace-tenancy.md D9）', () => {
  it('成員：以 P(u, W) 判斷權限鍵，並把 WorkspaceScope 寫進 request', async () => {
    const { guard, permissionService } = createWorkspaceGuard({
      permissions: ['file:read'],
      canEnter: true,
    });
    const { context, req } = createWorkspaceContext('listFiles');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(permissionService.getWorkspacePermissionSet).toHaveBeenCalledWith(
      'user-1',
      WORKSPACE_ID,
    );
    expect(permissionService.getPermissionSet).not.toHaveBeenCalled();
    expect(req.workspace).toEqual({ workspaceId: WORKSPACE_ID });
  });

  it('不能進入 → WORKSPACE_NOT_FOUND（@Authenticated 的工作區路由也一樣）', async () => {
    const { guard } = createWorkspaceGuard({ permissions: [], canEnter: false });
    await expect(guard.canActivate(createWorkspaceContext('me').context)).rejects.toMatchObject({
      code: 'WORKSPACE_NOT_FOUND',
    });
  });

  it('工作區 id 不是 uuid → WORKSPACE_NOT_FOUND，不查資料庫', async () => {
    const { guard, permissionService } = createWorkspaceGuard({ permissions: [], canEnter: true });
    await expect(
      guard.canActivate(createWorkspaceContext('me', 'not-a-uuid').context),
    ).rejects.toMatchObject({ code: 'WORKSPACE_NOT_FOUND' });
    expect(permissionService.getWorkspacePermissionSet).not.toHaveBeenCalled();
  });

  it('成員但缺權限鍵 → AUTHZ_FORBIDDEN', async () => {
    const { guard } = createWorkspaceGuard({ permissions: [], canEnter: true });
    await expect(
      guard.canActivate(createWorkspaceContext('listFiles').context),
    ).rejects.toMatchObject({ code: 'AUTHZ_FORBIDDEN' });
  });
});
