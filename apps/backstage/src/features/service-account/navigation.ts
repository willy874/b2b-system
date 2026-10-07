import { registerNavItem } from '@b2b-system/web-core/navigation';

import { NavGroupKey } from '@/core/navigation';

import { SERVICE_ACCOUNT_PAGE } from './permission';

/** 側欄的入口；命令面板的「頁面」也列出它（docs/architecture/frontend/18-command-palette.md §2）。 */
export function registerServiceAccountNavigation(): void {
  registerNavItem({
    pageKey: SERVICE_ACCOUNT_PAGE,
    to: '/service-account',
    labelKey: 'menu.serviceAccount',
    testId: 'menu-service-account',
    icon: 'monitor',
    group: NavGroupKey.PEOPLE,
    order: 400,
  });
}
