import { registerNavItem } from '@b2b-system/web-core/navigation';

import { NavGroupKey } from '@/core/navigation';

import { GROUP_PAGE } from './permission';

/** 側欄的入口；命令面板的「頁面」也列出它（docs/architecture/frontend/18-command-palette.md §2）。 */
export function registerGroupNavigation(): void {
  registerNavItem({
    pageKey: GROUP_PAGE,
    to: '/group',
    labelKey: 'menu.userGroup',
    testId: 'menu-group',
    icon: 'users',
    group: NavGroupKey.PEOPLE,
    order: 300,
  });
}
