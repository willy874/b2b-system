import { registerNavItem } from '@b2b-system/web-core/navigation';

import { NavGroupKey } from '@/core/navigation';

import { PLATFORM_ADMIN_PAGE } from './permission';

/** 側欄的入口；命令面板的「頁面」也列出它（docs/architecture/frontend/18-command-palette.md §2）。 */
export function registerPlatformAdminNavigation(): void {
  registerNavItem({
    pageKey: PLATFORM_ADMIN_PAGE,
    to: '/admin',
    labelKey: 'menu.platformAdmin',
    testId: 'menu-platform-admin',
    icon: 'users',
    group: NavGroupKey.PEOPLE,
    order: 100,
  });
}
