import { registerNavItem } from '@b2b-system/web-core/navigation';

import { NavGroupKey } from '@/core/navigation';

import { SETTING_PAGE } from './permission';

/** 側欄的入口；命令面板的「頁面」也列出它（docs/architecture/frontend/18-command-palette.md §2）。 */
export function registerSystemNavigation(): void {
  registerNavItem({
    pageKey: SETTING_PAGE,
    to: '/system/settings',
    labelKey: 'menu.setting',
    testId: 'menu-setting',
    icon: 'settings',
    group: NavGroupKey.SYSTEM,
    order: 800,
  });
}
