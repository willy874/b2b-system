import { useCallback, useMemo } from 'react';

import { usePermissionStore } from '@/core/store/permission';

import { buildPermissionKey, evaluateAccess, PermissionAction, PermissionMatch } from './constants';
import type { PageKey, PagePermissionRule } from './constants';
import type { PermissionKey } from './enums';
import { getPagePermission, requirePagePermission, resolvePageKey } from './registry';

export interface PermissionFacade {
  hydrated: boolean;
  permissions: Set<PermissionKey>;
  can: (key: PermissionKey) => boolean;
  canEvery: (keys: readonly PermissionKey[]) => boolean;
  canSome: (keys: readonly PermissionKey[]) => boolean;
}

/** 底層 hook。大多數情況應改用頁面級 hook 或 feature 的 facade。 */
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

  return { hydrated, permissions, can, canEvery, canSome };
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

/** 回傳穩定的 predicate，供選單 filter 這種不能呼叫 hook 的迴圈使用。 */
export function usePageAccessChecker(): {
  hydrated: boolean;
  canAccessPage: (page: PageKey) => boolean;
} {
  const facade = usePermission();
  const canAccessPage = useCallback(
    (page: PageKey) => {
      const registration = getPagePermission(page);
      if (!registration) return false;
      return evaluateAccess(registration.rule, facade.canEvery, facade.canSome);
    },
    [facade],
  );
  return { hydrated: facade.hydrated, canAccessPage };
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
  return useMemo(() => {
    const page = resolvePageKey(pathname);
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
  }, [facade, pathname]);
}

export { PermissionMatch };
