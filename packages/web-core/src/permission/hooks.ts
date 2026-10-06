import { useStore } from '@b2b-system/web-shared/hooks';
import { useCallback, useMemo } from 'react';

import { usePermissionStore } from '../store/permission';
import { buildPermissionKey, evaluateAccess, PermissionAction, PermissionMatch } from './constants';
import type { PageKey, PagePermissionRule } from './constants';
import type { PermissionKey } from './register';
import { pagePermissionRegistry, requirePagePermission, resolvePageKey } from './registry';

/** 註冊表的版本：feature 在執行期安裝或卸載時換新，依賴它的判斷跟著重算（docs/architecture/frontend/02-plugin-system.md §9.2 D4）。 */
function usePageRegistrations() {
  return useStore(pagePermissionRegistry.store, (state) => state.entries);
}

export interface PermissionFacade {
  hydrated: boolean;
  permissions: Set<PermissionKey>;
  can: (key: PermissionKey) => boolean;
  canEvery: (keys: readonly PermissionKey[]) => boolean;
  canSome: (keys: readonly PermissionKey[]) => boolean;
}

/**
 * 底層 hook。大多數情況應改用頁面級 hook 或 feature 的 facade。
 * 權限集合沒變時回傳同一個物件：`usePagePermission`、`usePageAccessChecker`、`usePageAccess` 與列表的 `rows`
 * 都以它（或從它衍生的值）當 memo 的依賴。
 */
export function usePermission(): PermissionFacade {
  const hydrated = usePermissionStore((state) => state.hydrated);
  const permissions = usePermissionStore((state) => state.permissions);

  const can = useCallback((key: PermissionKey) => permissions.has(key), [permissions]);
  const canEvery = useCallback(
    (keys: readonly PermissionKey[]) => keys.every((key) => permissions.has(key)),
    [permissions],
  );
  // 空陣列 = 不設限
  const canSome = useCallback(
    (keys: readonly PermissionKey[]) =>
      keys.length === 0 || keys.some((key) => permissions.has(key)),
    [permissions],
  );

  return useMemo(
    () => ({ hydrated, permissions, can, canEvery, canSome }),
    [hydrated, permissions, can, canEvery, canSome],
  );
}

export interface PagePermissionFacade {
  hydrated: boolean;
  canAccess: boolean;
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

function derive(
  rule: PagePermissionRule,
  facade: PermissionFacade,
): Omit<PagePermissionFacade, 'hydrated'> {
  const canAccess = evaluateAccess(rule, facade.canEvery, facade.canSome);
  const derived = (action: (typeof PermissionAction)[keyof typeof PermissionAction]) =>
    rule.resource ? facade.can(buildPermissionKey(rule.resource, action)) : false;

  return {
    canAccess,
    canCreate: derived(PermissionAction.CREATE),
    canRead: derived(PermissionAction.READ),
    canUpdate: derived(PermissionAction.UPDATE),
    canDelete: derived(PermissionAction.DELETE),
  };
}

export function usePagePermission(page: PageKey): PagePermissionFacade {
  const facade = usePermission();
  const { rule } = requirePagePermission(page);
  return useMemo(() => ({ hydrated: facade.hydrated, ...derive(rule, facade) }), [facade, rule]);
}

/**
 * 供選單 filter 這種不能呼叫 hook 的迴圈使用。`canAccessPage` 只在權限集合或頁面註冊表改變時換新，
 * 可以放進 memo 與 effect 的依賴。
 */
export function usePageAccessChecker(): {
  hydrated: boolean;
  canAccessPage: (page: PageKey) => boolean;
} {
  const { hydrated, canEvery, canSome } = usePermission();
  const registrations = usePageRegistrations();
  // 未註冊的頁面（所屬 feature 沒有啟用）一律不可進入：選單項目因此自動隱藏
  const canAccessPage = useCallback(
    (page: PageKey) => {
      const registration = registrations.get(page);
      if (!registration) return false;
      return evaluateAccess(registration.rule, canEvery, canSome);
    },
    [canEvery, canSome, registrations],
  );
  return { hydrated, canAccessPage };
}

export interface PageAccessState {
  hydrated: boolean;
  page?: PageKey;
  gated: boolean;
  canAccess: boolean;
}

/** 供 route guard 使用：未註冊或無限制的路徑回 `{ gated: false, canAccess: true }`。 */
export function usePageAccess(pathname: string): PageAccessState {
  const facade = usePermission();
  const registrations = usePageRegistrations();
  return useMemo(() => {
    const page = resolvePageKey(pathname, registrations);
    if (!page) return { hydrated: facade.hydrated, gated: false, canAccess: true };
    const registration = requirePagePermission(page);
    if (registration.rule.access.length === 0) {
      return { hydrated: facade.hydrated, page, gated: false, canAccess: true };
    }
    return {
      hydrated: facade.hydrated,
      page,
      gated: true,
      canAccess: evaluateAccess(registration.rule, facade.canEvery, facade.canSome),
    };
  }, [facade, pathname, registrations]);
}

export { PermissionMatch };
