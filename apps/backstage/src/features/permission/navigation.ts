import { registerNavItem } from '@b2b-system/web-core/navigation';

import { NavGroupKey } from '@/core/navigation';

import { PERMISSION_PAGE } from './permission';

/** 側欄的入口；命令面板的「頁面」也列出它（docs/architecture/frontend/18-command-palette.md §2）。 */
export function registerPermissionNavigation(): void {
  registerNavItem({
    pageKey: PERMISSION_PAGE,
    to: '/permission',
    labelKey: 'menu.permission',
    testId: 'menu-permission',
    icon: 'key',
    group: NavGroupKey.PEOPLE,
    order: 500,
  });
}
