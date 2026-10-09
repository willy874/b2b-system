import type { IconName } from '@b2b-system/ui/Icon';
import { useMemo } from 'react';

import { usePageAccessChecker } from '../permission';
import type { PageKey } from '../permission';

export interface MenuItem {
  pageKey: PageKey;
  to: string;
  labelKey: string;
  icon: IconName;
  /** 數字徽章（`NavItem.useBadge`）；只有側欄顯示。 */
  useBadge?: () => number | undefined;
}

export function useMenuItems<T extends MenuItem>(items: T[]): T[] {
  const { hydrated, canAccessPage } = usePageAccessChecker();
  // 未水合時回空陣列，而不是顯示全部再消失
  return useMemo(
    () => (hydrated ? items.filter((item) => canAccessPage(item.pageKey)) : []),
    [canAccessPage, hydrated, items],
  );
}

/** 首頁只在完全相等時命中，其他頁面連子路徑（`/user/123`）也算。 */
export function isMenuItemActive(to: string, pathname: string): boolean {
  return pathname === to || (to !== '/' && pathname.startsWith(`${to}/`));
}
