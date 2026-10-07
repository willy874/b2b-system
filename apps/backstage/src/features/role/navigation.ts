import { registerNavItem } from '@b2b-system/web-core/navigation';

import { NavGroupKey } from '@/core/navigation';

import { ROLE_PAGE } from './permission';

/** 側欄的入口；命令面板的「頁面」也列出它（docs/architecture/frontend/18-command-palette.md §2）。 */
export function registerRoleNavigation(): void {
  registerNavItem({
    pageKey: ROLE_PAGE,
    to: '/role',
    labelKey: 'menu.role',
    testId: 'menu-role',
    icon: 'shield',
    group: NavGroupKey.PEOPLE,
    order: 200,
  });
}
