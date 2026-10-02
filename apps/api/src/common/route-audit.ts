import { RequestMethod } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import {
  GATEWAY_METADATA,
  MESSAGE_MAPPING_METADATA,
  MESSAGE_METADATA,
} from '@nestjs/websockets/constants';

import { FEATURE_FLAGS } from '@/core/feature-flags/feature-flags';
import type { FeatureFlagDefinition } from '@/core/feature-flags/feature-flags';
import type { TenantFeature } from '@/core/tenant';

import {
  API_SURFACE,
  IS_AUTHENTICATED,
  IS_PUBLIC,
  REQUIRED_FEATURE,
  REQUIRED_FLAG,
  REQUIRED_PERMISSIONS,
  REQUIRED_PLATFORM_PERMISSIONS,
} from './decorators';
import type {
  ApiSurface,
  PermissionRequirement,
  PlatformPermissionRequirement,
} from './decorators';
import type { PermissionKey, PlatformPermissionKey } from './types';

export interface RouteDeclaration {
  method: string;
  path: string;
  declaration: 'public' | 'authenticated' | 'permissions' | 'platformPermissions' | 'none';
  keys: PermissionKey[];
  /** `@RequirePlatformPermissions` 的鍵（平台的權限目錄，docs/architecture/05-tenancy.md §10.2 D5）。 */
  platformKeys: PlatformPermissionKey[];
  match?: 'every' | 'some';
  /**
   * `@RequireFeature` 標的 feature（docs/architecture/frontend/02-plugin-system.md §9.2 D11），handler 與 class 的合併；
   * 沒有標就是常駐的端點。
   */
  features?: TenantFeature[];
  /** `@RequireFlag` 標的 feature flag（docs/architecture/05-tenancy.md §11.2 D5）。 */
  flag?: string;
  /** 屬於哪一個入口（docs/architecture/06-external-api.md §9.2 D11）；沒標是 `internal`。 */
  surface: ApiSurface;
}

/** Gateway 的 `@SubscribeMessage` 處理器（docs/architecture/backend/08-realtime.md §5）。 */
export interface GatewayMessageDeclaration {
  gateway: string;
  event: string;
  declaration: RouteDeclaration['declaration'];
  keys: PermissionKey[];
  platformKeys: PlatformPermissionKey[];
  match?: 'every' | 'some';
}

type Declaration = Pick<RouteDeclaration, 'declaration' | 'keys' | 'platformKeys' | 'match'>;

function declarationOf(reflector: Reflector, handler: object, metatype: object): Declaration {
  const targets = [handler, metatype] as Array<() => void>;
  const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
  const isAuthenticated = reflector.getAllAndOverride<boolean>(IS_AUTHENTICATED, targets);
  const requirement = reflector.getAllAndOverride<PermissionRequirement>(
    REQUIRED_PERMISSIONS,
    targets,
  );
  const platform = reflector.getAllAndOverride<PlatformPermissionRequirement>(
    REQUIRED_PLATFORM_PERMISSIONS,
    targets,
  );
  return {
    declaration: isPublic
      ? 'public'
      : isAuthenticated
        ? 'authenticated'
        : requirement
          ? 'permissions'
          : platform
            ? 'platformPermissions'
            : 'none',
    keys: requirement?.keys ?? [],
    platformKeys: platform?.keys ?? [],
    match: requirement?.match ?? (platform ? 'every' : undefined),
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
      const features = reflector.getAllAndMerge<TenantFeature[]>(REQUIRED_FEATURE, [
        handler as () => void,
        metatype,
      ]);
      const flag = reflector.getAllAndOverride<string | undefined>(REQUIRED_FLAG, [
        handler as () => void,
        metatype,
      ]);
      const surface =
        reflector.getAllAndOverride<ApiSurface | undefined>(API_SURFACE, [
          handler as () => void,
          metatype,
        ]) ?? 'internal';
      declarations.push({
        method: RequestMethod[verb] ?? 'GET',
        path: joinPath(controllerPath, subPath),
        surface,
        ...declarationOf(reflector, handler, metatype),
        ...(features.length > 0 && { features }),
        ...(flag && { flag }),
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
export function auditRoutes(
  app: INestApplication,
  flagCatalog: readonly FeatureFlagDefinition[] = FEATURE_FLAGS,
): void {
  const routes = collectRouteDeclarations(app);
  const undeclared = routes.filter((r) => r.declaration === 'none');
  if (undeclared.length) {
    throw new Error(
      '以下路由未宣告授權策略（需要 @Public / @Authenticated / @RequirePermissions / @RequirePlatformPermissions 其中之一）：\n' +
        undeclared.map((r) => `  - ${r.method} ${r.path}`).join('\n'),
    );
  }

  // 平台的請求沒有租戶脈絡，FeatureGuard 不判斷：標在平台端點上的 @RequireFeature 永遠不生效，視為寫錯
  const misplaced = routes.filter((r) => r.features && r.declaration === 'platformPermissions');
  if (misplaced.length) {
    throw new Error(
      '以下平台端點標了 @RequireFeature（feature 以租戶為單位，平台端點不適用）：\n' +
        misplaced.map((r) => `  - ${r.method} ${r.path}（${r.features?.join(', ')}）`).join('\n'),
    );
  }

  // flag 同樣以租戶為單位判斷（docs/architecture/05-tenancy.md §11.2 D5）；目錄裡沒有的 key 永遠是關的，等於把端點關死，視為寫錯
  const knownFlags = new Set(flagCatalog.map((flag) => flag.key));
  const badFlags = routes.filter(
    (r) => r.flag && (r.declaration === 'platformPermissions' || !knownFlags.has(r.flag)),
  );
  if (badFlags.length) {
    throw new Error(
      '以下端點的 @RequireFlag 無效（平台端點不適用；key 必須在 core/feature-flags 的目錄裡）：\n' +
        badFlags.map((r) => `  - ${r.method} ${r.path}（${r.flag}）`).join('\n'),
    );
  }

  // 入口的分界（docs/architecture/06-external-api.md §9.2 D11、D12）：對外的路由一律在 /v<n>/ 底下、要登入
  // （只認 API token；平台端點不對外）；內部的不能佔用 /v<n>/；兩邊都有的只給公開的健康檢查
  const versioned = /^\/v\d+(\/|$)/;
  const badSurface = routes.filter((r) =>
    r.surface === 'external'
      ? !versioned.test(r.path) ||
        r.declaration === 'public' ||
        r.declaration === 'platformPermissions'
      : r.surface === 'both'
        ? r.declaration !== 'public'
        : versioned.test(r.path),
  );
  if (badSurface.length) {
    throw new Error(
      '以下路由的入口宣告不正確（對外路由要在 /v<n>/ 底下且不能是 @Public／平台端點；內部路由不能在 /v<n>/ 底下；' +
        '兩邊都有的只能是 @Public）：\n' +
        badSurface
          .map((r) => `  - ${r.method} ${r.path}（${r.surface}、${r.declaration}）`)
          .join('\n'),
    );
  }

  // WebSocket 連線本身一定已驗證，`@Public()` 在這裡沒有意義，出現即視為寫錯
  // （docs/architecture/backend/08-realtime.md §5）。
  // 平台管理者不經 WebSocket（只有租戶網域上的 backstage 會連），`@RequirePlatformPermissions` 也不該出現
  const invalid = collectGatewayDeclarations(app).filter(
    (m) =>
      m.declaration === 'none' ||
      m.declaration === 'public' ||
      m.declaration === 'platformPermissions',
  );
  if (invalid.length) {
    throw new Error(
      '以下 WebSocket 訊息處理器未宣告授權策略（需要 @Authenticated / @RequirePermissions；不可用 @Public / @RequirePlatformPermissions）：\n' +
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

export function collectDeclaredPlatformPermissionKeys(
  app: INestApplication,
): PlatformPermissionKey[] {
  return [...new Set(collectRouteDeclarations(app).flatMap((r) => r.platformKeys))];
}
