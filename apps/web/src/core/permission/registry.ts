import type { PageKey, PagePermissionRule } from './constants';

export interface PageRegistration {
  rule: PagePermissionRule;
  /**
   * 錨定這一頁的 base path。`/role` 會命中 `/role`、`/role/create`、`/role/$id/…`。
   * 根路徑 `/` 只精確命中。
   */
  route: string;
}

const registry = new Map<PageKey, PageRegistration>();

export function registerPagePermission(page: PageKey, registration: PageRegistration): void {
  if (registry.has(page)) throw new Error(`Page permission already registered: ${page}`);
  for (const [existing, value] of registry) {
    if (value.route === registration.route) {
      throw new Error(`Route "${registration.route}" is already registered by page ${existing}`);
    }
  }
  registry.set(page, registration);
}

/** miss 時丟例外：所有呼叫點都在 plugin 註冊之後，miss 只可能是 feature 忘了註冊。 */
export function requirePagePermission(page: PageKey): PageRegistration {
  const registration = registry.get(page);
  if (!registration) {
    throw new Error(
      `Page permission not registered: ${page}. 請在擁有它的 feature 的 permission.ts 中註冊。`,
    );
  }
  return registration;
}

export function getPagePermission(page: PageKey): PageRegistration | undefined {
  return registry.get(page);
}

/**
 * miss 時回 undefined：路徑可能本來就不受管（/auth/*、devtools）。
 * 命中多筆時取 **最長** 的 base path：`/user/create` 有自己的規則時，
 * 不應該被 `/user` 的規則蓋過去。
 */
export function resolvePageKey(pathname: string): PageKey | undefined {
  let matched: { page: PageKey; length: number } | undefined;

  for (const [page, { route }] of registry) {
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
  return [...registry.keys()];
}

/** 測試專用。正式程式從不解除註冊。 */
export function resetPagePermissionRegistry(): void {
  registry.clear();
}

/** 從 route 物件讀 base path（不能用 `route.to`：router 建立前是 undefined）。 */
export function routeBasePath(route: unknown): string {
  const path = (route as { options?: { path?: string } }).options?.path;
  if (!path) throw new Error('route 沒有 path，無法註冊頁面權限');
  return path;
}
