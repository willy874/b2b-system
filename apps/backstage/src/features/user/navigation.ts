import { registerNavItem } from '@b2b-system/web-core/navigation';

import { NavGroupKey } from '@/core/navigation';

import { USER_PAGE } from './permission';

/** 側欄的入口；命令面板的「頁面」也列出它（docs/architecture/frontend/18-command-palette.md §2）。 */
export function registerUserNavigation(): void {
  registerNavItem({
    pageKey: USER_PAGE,
    to: '/user',
    labelKey: 'menu.user',
    testId: 'menu-user',
    icon: 'users',
    group: NavGroupKey.PEOPLE,
    order: 100,
  });
}
