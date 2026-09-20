import { RequestMethod } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';

import { IS_AUTHENTICATED, IS_PUBLIC, REQUIRED_PERMISSIONS } from './decorators';
import type { PermissionRequirement } from './decorators';
import type { PermissionKey } from './types';

export interface RouteDeclaration {
  method: string;
  path: string;
  declaration: 'public' | 'authenticated' | 'permissions' | 'none';
  keys: PermissionKey[];
  match?: 'every' | 'some';
}

function joinPath(base: unknown, sub: unknown): string {
  const left = typeof base === 'string' ? base : '';
  const right = typeof sub === 'string' ? sub : '';
  const joined = `/${left}/${right}`.replaceAll(/\/+/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
}

/** 掃描所有 controller 的 handler metadata，回傳每個路由的授權宣告。 */
export function collectRouteDeclarations(app: INestApplication): RouteDeclaration[] {
  const discovery = app.get(DiscoveryService);
  const reflector = app.get(Reflector);
  const scanner = new MetadataScanner();
  const declarations: RouteDeclaration[] = [];

  for (const wrapper of discovery.getControllers()) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype) continue;
    const controllerPath = Reflect.getMetadata(PATH_METADATA, metatype) as unknown;
    const prototype = Object.getPrototypeOf(instance) as object;

    for (const methodName of scanner.getAllMethodNames(prototype)) {
      const handler = (prototype as Record<string, unknown>)[methodName];
      if (typeof handler !== 'function') continue;
      const subPath = Reflect.getMetadata(PATH_METADATA, handler) as unknown;
      if (subPath === undefined) continue;

      const verb = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod;
      const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC, [handler, metatype]);
      const isAuthenticated = reflector.getAllAndOverride<boolean>(IS_AUTHENTICATED, [
        handler,
        metatype,
      ]);
      const requirement = reflector.getAllAndOverride<PermissionRequirement>(REQUIRED_PERMISSIONS, [
        handler,
        metatype,
      ]);

      declarations.push({
        method: RequestMethod[verb] ?? 'GET',
        path: joinPath(controllerPath, subPath),
        declaration: isPublic
          ? 'public'
          : isAuthenticated
            ? 'authenticated'
            : requirement
              ? 'permissions'
              : 'none',
        keys: requirement?.keys ?? [],
        match: requirement?.match,
      });
    }
  }

  return declarations.sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  );
}

/**
 * 「預設拒絕」策略的守門員：任何未宣告授權的路由都讓程序啟動失敗。
 * 於 `app.listen()` 之前呼叫（docs/backend/05-rbac.md §7）。
 */
export function auditRoutes(app: INestApplication): void {
  const undeclared = collectRouteDeclarations(app).filter((r) => r.declaration === 'none');
  if (undeclared.length) {
    throw new Error(
      '以下路由未宣告授權策略（需要 @Public / @Authenticated / @RequirePermissions 其中之一）：\n' +
        undeclared.map((r) => `  - ${r.method} ${r.path}`).join('\n'),
    );
  }
}

export function collectDeclaredPermissionKeys(app: INestApplication): PermissionKey[] {
  const keys = collectRouteDeclarations(app).flatMap((r) => r.keys);
  return [...new Set(keys)];
}
