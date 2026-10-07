import { registerNavItem } from '@b2b-system/web-core/navigation';

import { HOME_PAGE } from './permission';

/** 側欄最上方的入口；命令面板的「頁面」也列出它（docs/architecture/frontend/18-command-palette.md §2）。 */
export function registerHomeNavigation(): void {
  registerNavItem({
    pageKey: HOME_PAGE,
    to: '/',
    labelKey: 'menu.home',
    testId: 'menu-home',
    icon: 'home',
    order: 100,
  });
}
