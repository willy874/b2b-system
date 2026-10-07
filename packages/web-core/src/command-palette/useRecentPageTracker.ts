import { useStore } from '@b2b-system/web-shared/hooks';
import { useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';

import { navItemRegistry } from '../navigation';
import { pagePermissionRegistry, resolvePageKey } from '../permission';
import { useRecentPageStore } from './recent';

/**
 * 換頁時把目前頁面記進「最近造訪」：只記有選單入口的頁面，子路徑（`/user/123`）算在它的頁面（使用者）底下。
 * 掛在外框（`DashboardShell`）。
 */
export function useRecentPageTracker(): void {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const registrations = useStore(pagePermissionRegistry.store, (state) => state.entries);
  const navItems = useStore(navItemRegistry.store, (state) => state.entries);
  const record = useRecentPageStore((state) => state.record);

  useEffect(() => {
    const page = resolvePageKey(pathname, registrations);
    if (page && navItems.has(page)) record(page);
  }, [navItems, pathname, record, registrations]);
}
