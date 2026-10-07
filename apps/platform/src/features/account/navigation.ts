import { registerNavItem } from '@b2b-system/web-core/navigation';

import { PREFERENCE_PAGE, PROFILE_PAGE } from './permission';

/** 帳號選單裡的頁面；命令面板的「頁面」也列出它們（docs/architecture/frontend/18-command-palette.md §2）。 */
export function registerAccountNavigation(): void {
  registerNavItem({
    pageKey: PROFILE_PAGE,
    to: '/profile',
    labelKey: 'menu.profile',
    testId: 'menu-profile',
    icon: 'user',
    placement: 'account',
    order: 100,
  });
  registerNavItem({
    pageKey: PREFERENCE_PAGE,
    to: '/preference',
    labelKey: 'menu.preference',
    testId: 'menu-preference',
    icon: 'settings',
    placement: 'account',
    order: 200,
  });
}
