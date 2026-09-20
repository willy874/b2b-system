import { Controller, Get, Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DiscoveryModule } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';

import { Public, RequirePermissions } from '@/common/decorators';
import {
  auditRoutes,
  collectDeclaredPermissionKeys,
  collectRouteDeclarations,
} from '@/common/route-audit';
import { ALL_PERMISSION_KEYS } from '@/db/seeds/permissions';

let app: INestApplication;

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

@Module({ imports: [DiscoveryModule], controllers: [DeclaredController, UndeclaredController] })
class UndeclaredModule {}

describe('路由稽核（docs/backend/05-rbac.md §7）', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = inject('databaseUrl');
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

  it('端點 × 權限總表與 docs/backend/05-rbac.md §9 一致', () => {
    const actual = new Map(
      collectRouteDeclarations(app).map((route) => [
        `${route.method} ${route.path}`,
        route.declaration === 'permissions' ? route.keys.join('+') : route.declaration,
      ]),
    );

    // 文件 §9 的表格（節錄為機器可比對的形式）
    const expected: Record<string, string> = {
      'POST /auth/login': 'public',
      'POST /auth/refresh': 'public',
      'POST /auth/forgot-password': 'public',
      'POST /auth/reset-password': 'public',
      'GET /auth/setup/verify': 'public',
      'POST /auth/setup': 'public',
      'POST /auth/logout': 'authenticated',
      'GET /auth/profile': 'authenticated',
      'PATCH /auth/profile': 'authenticated',
      'POST /auth/change-password': 'authenticated',
      'GET /users': 'user:read',
      'POST /users': 'user:create',
      'GET /users/:id': 'user:read',
      'PATCH /users/:id': 'user:update',
      'DELETE /users/:id': 'user:delete',
      'GET /users/:id/roles': 'user:read',
      'PUT /users/:id/roles': 'user:assignRole',
      'GET /users/:id/permissions': 'user:read',
      'POST /users/:id/reset-password': 'user:resetPassword',
      'POST /users/:id/unlock': 'user:update',
      'GET /roles': 'role:read',
      'POST /roles': 'role:create',
      'GET /roles/:id': 'role:read',
      'PATCH /roles/:id': 'role:update',
      'DELETE /roles/:id': 'role:delete',
      'GET /roles/:id/permissions': 'role:read+permission:read',
      'PATCH /roles/:id/permissions': 'role:grantPermission',
      'GET /roles/:id/users': 'role:read+user:read',
      'POST /roles/:id/duplicate': 'role:create',
      'GET /permissions': 'permission:read',
      'GET /audit-logs': 'auditLog:read',
      'GET /audit-logs/:id': 'auditLog:read',
      'GET /health': 'public',
      'GET /health/ready': 'public',
      'GET /system/info': 'system:read',
    };

    for (const [route, declaration] of Object.entries(expected)) {
      expect(actual.get(route), `${route} 的授權宣告`).toBe(declaration);
    }
    expect(actual.size).toBe(Object.keys(expected).length);
  });
});
