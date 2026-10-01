import { Controller, Get, Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DiscoveryModule } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Authenticated, ExternalApi, Public, RequirePermissions } from '@/common/decorators';
import {
  auditRoutes,
  collectDeclaredPermissionKeys,
  collectDeclaredPlatformPermissionKeys,
  collectGatewayDeclarations,
  collectRouteDeclarations,
} from '@/common/route-audit';
import { ALL_PERMISSION_KEYS } from '@/db/seeds/permissions';
import { ALL_PLATFORM_PERMISSION_KEYS } from '@/db/seeds/platform-permissions';

let app: INestApplication;

/**
 * 路由 → 應標的 feature（docs/adr/0021-runtime-feature-activation.md D11、docs/adr/0029-toggleable-platform-features.md）；
 * 平台的 /platform/jobs 不屬於任何租戶，不標。還原端點屬於回收桶，handler 的 `trash` 排在 class 的之前。
 */
function featuresOf(method: string, path: string): string[] | undefined {
  const restore = method === 'POST' && path.endsWith('/:id/restore');
  if (/^\/(files|file-folders)(\/|$)/.test(path)) return restore ? ['trash', 'file'] : ['file'];
  if (restore || /^\/trash(\/|$)/.test(path)) return ['trash'];
  if (/^\/audit-logs(\/|$)/.test(path)) return ['auditLog'];
  if (/^\/jobs(\/|$)/.test(path)) return ['job'];
  if (path === '/system/settings') return ['systemSetting'];
  if (/^\/identity-providers(\/|$)/.test(path)) return ['identityProvider'];
  return undefined;
}

@Controller('declared')
class DeclaredController {
  @Get()
  @RequirePermissions('role:read')
  list(): void {}

  @Get('public')
  @Public()
  open(): void {}
}

@Controller('undeclared')
class UndeclaredController {
  @Get()
  oops(): void {}
}

@Module({ imports: [DiscoveryModule], controllers: [DeclaredController] })
class DeclaredModule {}

// 入口的分界（docs/adr/0027-api-tokens-external-api.md D11）：三種寫錯的方式
@ExternalApi()
@Controller('v1/open')
class ExternalPublicController {
  @Get()
  @Public()
  open(): void {}
}

@ExternalApi()
@Controller('outside')
class ExternalOutsideVersionController {
  @Get()
  @Authenticated()
  me(): void {}
}

@Controller('v1/internal')
class InternalUnderVersionController {
  @Get()
  @Authenticated()
  me(): void {}
}

@Module({ imports: [DiscoveryModule], controllers: [DeclaredController, UndeclaredController] })
class UndeclaredModule {}

describe('路由稽核（docs/architecture/backend/05-rbac.md §7）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = 'route-audit@example.com';
    const { AppModule } = await import('@/app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('每一個路由都宣告了授權策略', () => {
    expect(() => auditRoutes(app)).not.toThrow();
  });

  it('故意建立一個沒有授權宣告的路由 → 稽核失敗（程序啟動會中止）', async () => {
    const bad = await NestFactory.create(UndeclaredModule, { logger: false });
    await bad.init();
    expect(() => auditRoutes(bad)).toThrow(/未宣告授權策略/);
    expect(() => auditRoutes(bad)).toThrow(/GET \/undeclared/);
    await bad.close();
  });

  it.each([
    ['對外的路由是 @Public', ExternalPublicController, /GET \/v1\/open/],
    ['對外的路由不在 /v<n>/ 底下', ExternalOutsideVersionController, /GET \/outside/],
    ['內部的路由佔用 /v<n>/', InternalUnderVersionController, /GET \/v1\/internal/],
  ])('入口宣告寫錯 → 稽核失敗：%s', async (_label, controller, route) => {
    @Module({ imports: [DiscoveryModule], controllers: [controller] })
    class BadSurfaceModule {}
    const bad = await NestFactory.create(BadSurfaceModule, { logger: false });
    await bad.init();
    expect(() => auditRoutes(bad)).toThrow(/入口宣告不正確/);
    expect(() => auditRoutes(bad)).toThrow(route);
    await bad.close();
  });

  it('對外 API 的路由清單（docs/adr/0027-api-tokens-external-api.md D11）', () => {
    const external = collectRouteDeclarations(app)
      .filter((route) => route.surface !== 'internal')
      .map((route) => `${route.surface} ${route.method} ${route.path} ${route.declaration}`);
    expect(external).toEqual([
      'both GET /health public',
      'both GET /health/ready public',
      'external GET /v1/me authenticated',
    ]);
  });

  it('全部宣告時不拋錯', async () => {
    const good = await NestFactory.create(DeclaredModule, { logger: false });
    await good.init();
    expect(() => auditRoutes(good)).not.toThrow();
    await good.close();
  });

  it('@RequirePermissions 使用的鍵全部存在於權限目錄（防 typo）', () => {
    const declared = collectDeclaredPermissionKeys(app);
    expect(declared.length).toBeGreaterThan(0);
    for (const key of declared) expect(ALL_PERMISSION_KEYS).toContain(key);
  });

  it('@RequirePlatformPermissions 使用的鍵全部存在於平台的權限目錄', () => {
    const declared = collectDeclaredPlatformPermissionKeys(app);
    expect(declared.length).toBeGreaterThan(0);
    for (const key of declared) expect(ALL_PLATFORM_PERMISSION_KEYS).toContain(key);
  });

  it('端點 × 權限總表與 docs/architecture/backend/05-rbac.md §9 一致', () => {
    const actual = new Map(
      collectRouteDeclarations(app).map((route) => [
        `${route.method} ${route.path}`,
        route.declaration === 'permissions'
          ? route.keys.join(route.match === 'some' ? '|' : '+')
          : route.declaration === 'platformPermissions'
            ? `platform ${route.platformKeys.join('+')}`
            : route.declaration,
      ]),
    );

    // 文件 §9 的表格（節錄為機器可比對的形式）：EVERY 寫成 a+b、SOME 寫成 a|b
    const expected: Record<string, string> = {
      'POST /auth/login': 'public',
      'POST /auth/refresh': 'public',
      'POST /auth/register': 'public',
      'POST /auth/forgot-password': 'public',
      'POST /auth/reset-password': 'public',
      'GET /auth/setup/verify': 'public',
      'POST /auth/setup': 'public',
      'POST /auth/sso/callback': 'public',
      'POST /platform/auth/sso/callback': 'public',
      'POST /platform/auth/refresh': 'public',
      'POST /platform/auth/logout': 'authenticated',
      'GET /platform/auth/profile': 'authenticated',
      'GET /platform/auth/setup/verify': 'public',
      'POST /platform/auth/setup': 'public',
      'POST /platform/auth/reset-password': 'public',
      'GET /platform/admins': 'platform platformAdmin:read',
      'POST /platform/admins': 'platform platformAdmin:create',
      'PATCH /platform/admins/:id': 'platform platformAdmin:update',
      'POST /platform/admins/:id/password-link': 'platform platformAdmin:update',
      'GET /platform/audit-logs': 'platform platformAuditLog:read',
      'GET /platform/feature-flags': 'platform featureFlag:read',
      'PUT /platform/feature-flags/:key': 'platform featureFlag:update',
      'GET /platform/jobs/queues': 'platform platformJob:read',
      'GET /platform/jobs': 'platform platformJob:read',
      'GET /platform/jobs/:id': 'platform platformJob:read',
      'POST /platform/jobs/:id/retry': 'platform platformJob:retry',
      'GET /platform/tenants': 'platform tenant:read',
      'GET /platform/tenants/:id': 'platform tenant:read',
      'POST /platform/tenants': 'platform tenant:create',
      'PATCH /platform/tenants/:id': 'platform tenant:update',
      'POST /platform/tenants/:id/provision': 'platform tenant:create',
      'POST /platform/tenants/:id/disable': 'platform tenant:update',
      'POST /platform/tenants/:id/enable': 'platform tenant:update',
      'DELETE /platform/tenants/:id': 'platform tenant:delete',
      'POST /platform/tenants/:id/domains': 'platform tenant:update',
      'DELETE /platform/tenants/:id/domains/:domain': 'platform tenant:update',
      'GET /tenant/current': 'public',
      'GET /tenants/lookup': 'public',
      'GET /oidc-interaction/:uid': 'public',
      'GET /oidc-interaction/:uid/details': 'public',
      'POST /oidc-interaction/:uid/login': 'public',
      'POST /oidc-interaction/:uid/abort': 'public',
      'GET /oidc-interaction/external/callback': 'public',
      'GET /oidc-interaction/:uid/discover': 'public',
      'POST /oidc-interaction/:uid/external': 'public',
      'GET /oidc-interaction/:uid/external/complete': 'public',
      'POST /auth/logout': 'authenticated',
      'GET /auth/profile': 'authenticated',
      'PATCH /auth/profile': 'authenticated',
      'POST /auth/change-password': 'authenticated',
      'GET /auth/api-tokens': 'authenticated',
      'POST /auth/api-tokens': 'authenticated',
      'DELETE /auth/api-tokens/:tokenId': 'authenticated',
      'GET /v1/me': 'authenticated',
      'GET /notifications': 'authenticated',
      'GET /notifications/unread-count': 'authenticated',
      'POST /notifications/read-all': 'authenticated',
      'POST /notifications/:id/read': 'authenticated',
      'GET /notification-events': 'system:read',
      'PATCH /notification-events': 'system:update',
      'GET /me/notification-preferences': 'authenticated',
      'PATCH /me/notification-preferences': 'authenticated',
      'GET /identity-providers': 'identityProvider:read',
      'POST /identity-providers': 'identityProvider:create',
      'PATCH /identity-providers/:id': 'identityProvider:update',
      'DELETE /identity-providers/:id': 'identityProvider:delete',
      'GET /users': 'user:read',
      'POST /users': 'user:create',
      'GET /users/:id': 'user:read',
      'PATCH /users/:id': 'user:update',
      'DELETE /users/:id': 'user:delete',
      'GET /users/:id/roles': 'user:read',
      'PUT /users/:id/roles': 'user:assignRole',
      'GET /users/:id/permissions': 'user:read',
      'GET /users/:id/permission-sources': 'authenticated',
      'POST /users/:id/reset-password': 'user:resetPassword',
      'POST /users/:id/unlock': 'user:update',
      'POST /users/:id/restore': 'user:delete',
      'GET /users/:userId/api-tokens': 'user:update',
      'DELETE /users/:userId/api-tokens/:tokenId': 'user:update',
      'GET /service-accounts': 'serviceAccount:read',
      'POST /service-accounts': 'serviceAccount:create',
      'GET /service-accounts/:id': 'serviceAccount:read',
      'PATCH /service-accounts/:id': 'serviceAccount:update',
      'DELETE /service-accounts/:id': 'serviceAccount:delete',
      'PUT /service-accounts/:id/roles': 'serviceAccount:update',
      'GET /service-accounts/:id/tokens': 'serviceAccount:read',
      'POST /service-accounts/:id/tokens': 'serviceAccount:update',
      'DELETE /service-accounts/:id/tokens/:tokenId': 'serviceAccount:update',
      'GET /trash': 'user:delete|role:delete|group:delete|file:delete',
      'GET /roles': 'role:read',
      'POST /roles': 'role:create',
      'GET /roles/:id': 'role:read',
      'PATCH /roles/:id': 'role:update',
      'DELETE /roles/:id': 'role:delete',
      'GET /roles/:id/permissions': 'role:read+permission:read',
      'PATCH /roles/:id/permissions': 'role:grantPermission',
      'GET /roles/:id/users': 'role:read+user:read',
      'POST /roles/:id/duplicate': 'role:create',
      'GET /groups': 'group:read',
      'POST /groups': 'group:create',
      'GET /groups/:id': 'group:read',
      'PATCH /groups/:id': 'group:update',
      'DELETE /groups/:id': 'group:delete',
      'POST /groups/:id/restore': 'group:delete',
      'GET /groups/:id/members': 'group:read+user:read',
      'PATCH /groups/:id/members': 'group:update',
      'GET /groups/:id/roles': 'group:read+role:read',
      'PATCH /groups/:id/roles': 'group:assignRole',
      'POST /roles/:id/restore': 'role:delete',
      'GET /roles/:id/revisions': 'role:read',
      'GET /roles/:id/revisions/:version': 'role:read',
      'POST /roles/:id/revisions/:version/revert': 'role:update',
      'GET /permissions': 'permission:read',
      'GET /audit-logs': 'auditLog:read',
      'GET /audit-logs/:id': 'auditLog:read',
      'GET /health': 'public',
      'GET /health/ready': 'public',
      'GET /system/info': 'system:read',
      'GET /system/settings': 'system:read',
      'GET /system/settings/public': 'public',
      'PATCH /system/settings': 'system:update',
      'GET /approvals': 'approval:read',
      'GET /approvals/:id': 'approval:read',
      'POST /approvals/:id/approve': 'approval:review',
      'POST /approvals/:id/reject': 'approval:review',
      'GET /jobs/queues': 'job:read',
      'GET /jobs': 'job:read',
      'GET /jobs/:id': 'job:read',
      'POST /jobs/:id/retry': 'job:retry',
      'GET /files': 'file:access|file:read',
      'POST /files': 'file:access|file:create',
      'GET /files/upload-policy': 'file:access|file:create',
      'POST /files/:id/parts': 'file:access|file:create',
      'POST /files/:id/complete': 'file:access|file:create',
      'DELETE /files/:id/upload': 'file:access|file:create',
      'GET /files/:id/image/:variant': 'public',
      'GET /files/:id': 'file:access|file:read',
      'PATCH /files/:id': 'file:access|file:update',
      'DELETE /files/:id': 'file:access|file:delete',
      'POST /files/:id/restore': 'file:access|file:delete',
      'POST /files/move': 'file:access|file:update',
      'GET /file-folders': 'file:access|file:read',
      'POST /file-folders': 'file:access|file:create',
      'POST /file-folders/paths': 'file:access|file:create',
      'PATCH /file-folders/:id': 'file:access|file:update',
      'DELETE /file-folders/:id': 'file:access|file:delete',
      'POST /file-folders/:id/restore': 'file:access|file:delete',
      'GET /file-folders/:id/grants': 'file:access|file:share',
      'PUT /file-folders/:id/grants': 'file:access|file:share',
      'DELETE /file-folders/:id/grants/:subjectType/:subjectId': 'file:access|file:share',
      'GET /file-folders/:id/grant-subjects': 'file:access|file:share',
      'GET /file-folders/:id/explain': 'authenticated',
      'PATCH /file-folders/:id/access': 'file:access|file:share',
      'POST /file-folders/:id/access-requests': 'file:access|file:read',
      'GET /file-folders/:id/access-requests': 'file:access|file:share',
      'POST /file-folders/:id/access-requests/:requestId/approve': 'file:access|file:share',
      'POST /file-folders/:id/access-requests/:requestId/reject': 'file:access|file:share',
    };

    for (const [route, declaration] of Object.entries(expected)) {
      expect(actual.get(route), `${route} 的授權宣告`).toBe(declaration);
    }
    expect(actual.size).toBe(Object.keys(expected).length);
  });

  it('@RequireFeature 標在可啟用 feature 的所有端點，其餘都沒有（docs/adr/0021-runtime-feature-activation.md D11）', () => {
    const routes = collectRouteDeclarations(app);
    expect(routes.some((route) => route.features)).toBe(true);
    for (const route of routes) {
      expect(route.features, `${route.method} ${route.path} 的 feature`).toEqual(
        featuresOf(route.method, route.path),
      );
    }
  });

  it('WebSocket 訊息處理器 × 權限總表與 docs/architecture/backend/08-realtime.md §5 一致', () => {
    const actual = new Map(
      collectGatewayDeclarations(app).map((message) => [
        `WS ${message.event}`,
        message.declaration === 'permissions' ? message.keys.join('+') : message.declaration,
      ]),
    );
    const expected: Record<string, string> = {
      'WS session.renew': 'authenticated',
      'WS channel.relay': 'authenticated',
    };

    for (const [event, declaration] of Object.entries(expected)) {
      expect(actual.get(event), `${event} 的授權宣告`).toBe(declaration);
    }
    expect(actual.size).toBe(Object.keys(expected).length);
  });
});
