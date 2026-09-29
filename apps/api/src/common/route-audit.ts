import { RequestMethod } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import {
  GATEWAY_METADATA,
  MESSAGE_MAPPING_METADATA,
  MESSAGE_METADATA,
} from '@nestjs/websockets/constants';

import { PERMISSION_SCOPE_OF } from '@/db/seeds/permissions';

import {
  IS_AUTHENTICATED,
  IS_PUBLIC,
  IS_WORKSPACE_SCOPED,
  REQUIRED_PERMISSIONS,
  WORKSPACE_ID_PARAM,
} from './decorators';
import type { PermissionRequirement } from './decorators';
import type { PermissionKey } from './types';

export interface RouteDeclaration {
  method: string;
  path: string;
  declaration: 'public' | 'authenticated' | 'permissions' | 'none';
  keys: PermissionKey[];
  match?: 'every' | 'some';
  /** `@WorkspaceScoped()`：guard 先確認成員資格，權限鍵以 P(u, W) 判斷。 */
  workspaceScoped: boolean;
}

/** Gateway 的 `@SubscribeMessage` 處理器（docs/architecture/backend/08-realtime.md §5）。 */
export interface GatewayMessageDeclaration {
  gateway: string;
  event: string;
  declaration: RouteDeclaration['declaration'];
  keys: PermissionKey[];
  match?: 'every' | 'some';
}

type Declaration = Pick<RouteDeclaration, 'declaration' | 'keys' | 'match'>;

function declarationOf(reflector: Reflector, handler: object, metatype: object): Declaration {
  const targets = [handler, metatype] as Array<() => void>;
  const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
  const isAuthenticated = reflector.getAllAndOverride<boolean>(IS_AUTHENTICATED, targets);
  const requirement = reflector.getAllAndOverride<PermissionRequirement>(
    REQUIRED_PERMISSIONS,
    targets,
  );
  return {
    declaration: isPublic
      ? 'public'
      : isAuthenticated
        ? 'authenticated'
        : requirement
          ? 'permissions'
          : 'none',
    keys: requirement?.keys ?? [],
    match: requirement?.match,
  };
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
      declarations.push({
        method: RequestMethod[verb] ?? 'GET',
        path: joinPath(controllerPath, subPath),
        ...declarationOf(reflector, handler, metatype),
        workspaceScoped: Boolean(
          reflector.getAllAndOverride<boolean>(IS_WORKSPACE_SCOPED, [handler, metatype] as Array<
            () => void
          >),
        ),
      });
    }
  }

  return declarations.sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  );
}

/** 掃描所有 gateway 的 `@SubscribeMessage` 處理器，回傳每個事件的授權宣告。 */
export function collectGatewayDeclarations(app: INestApplication): GatewayMessageDeclaration[] {
  const discovery = app.get(DiscoveryService);
  const reflector = app.get(Reflector);
  const scanner = new MetadataScanner();
  const declarations: GatewayMessageDeclaration[] = [];

  for (const wrapper of discovery.getProviders()) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype || !Reflect.getMetadata(GATEWAY_METADATA, metatype)) continue;
    const prototype = Object.getPrototypeOf(instance) as object;

    for (const methodName of scanner.getAllMethodNames(prototype)) {
      const handler = (prototype as Record<string, unknown>)[methodName];
      if (typeof handler !== 'function') continue;
      if (!Reflect.getMetadata(MESSAGE_MAPPING_METADATA, handler)) continue;
      const event = Reflect.getMetadata(MESSAGE_METADATA, handler) as unknown;

      declarations.push({
        gateway: metatype.name,
        event: typeof event === 'string' ? event : methodName,
        ...declarationOf(reflector, handler, metatype),
      });
    }
  }

  return declarations.toSorted(
    (a, b) => a.gateway.localeCompare(b.gateway) || a.event.localeCompare(b.event),
  );
}

/**
 * 「預設拒絕」策略的守門員：任何未宣告授權的路由都讓程序啟動失敗。
 * 於 `app.listen()` 之前呼叫（docs/architecture/backend/05-rbac.md §7）。
 */
export function auditRoutes(app: INestApplication): void {
  const routes = collectRouteDeclarations(app);
  const undeclared = routes.filter((r) => r.declaration === 'none');
  if (undeclared.length) {
    throw new Error(
      '以下路由未宣告授權策略（需要 @Public / @Authenticated / @RequirePermissions 其中之一）：\n' +
        undeclared.map((r) => `  - ${r.method} ${r.path}`).join('\n'),
    );
  }

  // 權限鍵的範圍要與路由一致（docs/adr/0018-workspace-tenancy.md D9）：工作區範圍的鍵只存在於
  // P(u, W)，宣告在平台路由上永遠不會通過；反過來，平台的鍵宣告在工作區路由上代表放錯了地方
  const misplaced = routes.flatMap((r) => {
    const expected = r.workspaceScoped ? 'workspace' : 'platform';
    const wrongKeys = r.keys.filter((key) => PERMISSION_SCOPE_OF[key] !== expected);
    const missingParam = r.workspaceScoped && !r.path.includes(`:${WORKSPACE_ID_PARAM}`);
    const unexpectedPublic = r.workspaceScoped && r.declaration === 'public';
    return wrongKeys.length || missingParam || unexpectedPublic
      ? [
          `  - ${r.method} ${r.path}（${r.workspaceScoped ? '工作區' : '平台'}路由` +
            (wrongKeys.length ? `；範圍不符的鍵：${wrongKeys.join(', ')}` : '') +
            (missingParam ? `；路徑缺少 :${WORKSPACE_ID_PARAM}` : '') +
            (unexpectedPublic ? '；不可 @Public' : '') +
            '）',
        ]
      : [];
  });
  if (misplaced.length) {
    throw new Error(
      '以下路由的工作區範圍宣告錯誤（工作區的鍵只能用在 @WorkspaceScoped 路由，平台的鍵只能用在其他路由）：\n' +
        misplaced.join('\n'),
    );
  }

  // WebSocket 連線本身一定已驗證，`@Public()` 在這裡沒有意義，出現即視為寫錯
  // （docs/architecture/backend/08-realtime.md §5）。
  const invalid = collectGatewayDeclarations(app).filter(
    (m) => m.declaration === 'none' || m.declaration === 'public',
  );
  if (invalid.length) {
    throw new Error(
      '以下 WebSocket 訊息處理器未宣告授權策略（需要 @Authenticated / @RequirePermissions；不可用 @Public）：\n' +
        invalid.map((m) => `  - WS ${m.gateway} ${m.event}（${m.declaration}）`).join('\n'),
    );
  }
}

export function collectDeclaredPermissionKeys(app: INestApplication): PermissionKey[] {
  const keys = [...collectRouteDeclarations(app), ...collectGatewayDeclarations(app)].flatMap(
    (r) => r.keys,
  );
  return [...new Set(keys)];
}
