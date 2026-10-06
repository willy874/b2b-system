import { createRegistry } from '@b2b-system/web-shared/registry';

import type { PageKey, PagePermissionRule } from './constants';

export interface PageRegistration {
  rule: PagePermissionRule;
  /**
   * 錨定這一頁的 base path。`/role` 會命中 `/role`、`/role/create`、`/role/$id/…`。
   * 根路徑 `/` 只精確命中。
   */
  route: string;
}

/**
 * 頁面權限的註冊表。可訂閱：feature 可能在 App 啟動後才安裝或被移除
 * （docs/architecture/frontend/02-plugin-system.md §9.2 D4），權限 hooks 以 `useStore(pagePermissionRegistry.store, …)` 跟著更新。
 */
export const pagePermissionRegistry = createRegistry<PageKey, PageRegistration>('Page permission');

/** 回傳反註冊函式；在 plugin 的 factory 裡呼叫時由容器收集，不必自己保存。 */
export function registerPagePermission(page: PageKey, registration: PageRegistration): () => void {
  for (const [existing, value] of pagePermissionRegistry.store.getState().entries) {
    if (value.route === registration.route) {
      throw new Error(`Route "${registration.route}" is already registered by page ${existing}`);
    }
  }
  return pagePermissionRegistry.register(page, registration);
}

/** miss 時丟例外：所有呼叫點都在 plugin 註冊之後，miss 只可能是 feature 忘了註冊。 */
export function requirePagePermission(page: PageKey): PageRegistration {
  const registration = pagePermissionRegistry.get(page);
  if (!registration) {
    throw new Error(
      `Page permission not registered: ${page}. 請在擁有它的 feature 的 permission.ts 中註冊。`,
    );
  }
  return registration;
}

/**
 * miss 時回 undefined：路徑可能本來就不受管（/auth/*、devtools）。
 * 命中多筆時取 **最長** 的 base path：`/user/create` 有自己的規則時，
 * 不應該被 `/user` 的規則蓋過去。
 */
export function resolvePageKey(
  pathname: string,
  entries: ReadonlyMap<PageKey, PageRegistration> = pagePermissionRegistry.store.getState().entries,
): PageKey | undefined {
  let matched: { page: PageKey; length: number } | undefined;

  for (const [page, { route }] of entries) {
    if (route === '/') {
      if (pathname === '/') return page;
      continue;
    }
    if (pathname !== route && !pathname.startsWith(`${route}/`)) continue;
    if (!matched || route.length > matched.length) matched = { page, length: route.length };
  }

  return matched?.page;
}

export function getRegisteredPageKeys(): PageKey[] {
  return pagePermissionRegistry.keys();
}

/** 測試專用。正式程式只經由 plugin 卸載解除註冊。 */
export function resetPagePermissionRegistry(): void {
  pagePermissionRegistry.reset();
}

interface RouteLike {
  options?: { path?: string; getParentRoute?: () => unknown };
}

/**
 * 從 route 物件讀 base path（不能用 `route.to`：router 建立前是 undefined）。
 * 巢狀的 route（例：`/user` 底下的 `create`）沿 `getParentRoute` 把上層的 path 接起來。
 */
export function routeBasePath(route: unknown): string {
  const path = (route as RouteLike).options?.path;
  if (!path) throw new Error('route 沒有 path，無法註冊頁面權限');
  const segments = [path];
  let parent = (route as RouteLike).options?.getParentRoute?.();
  while (parent) {
    const parentPath = (parent as RouteLike).options?.path;
    if (parentPath) segments.unshift(parentPath);
    parent = (parent as RouteLike).options?.getParentRoute?.();
  }
  return `/${segments
    .flatMap((segment) => segment.split('/'))
    .filter(Boolean)
    .join('/')}`;
}
