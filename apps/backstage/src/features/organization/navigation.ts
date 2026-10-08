import { registerNavItem } from '@b2b-system/web-core/navigation';

import { NavGroupKey } from '@/core/navigation';

import { ORG_UNIT_PAGE } from './permission';

/** 側欄的入口（「人員」群組，排在群組之後）；命令面板的「頁面」也列出它（docs/architecture/frontend/18-command-palette.md §2）。 */
export function registerOrganizationNavigation(): void {
  registerNavItem({
    pageKey: ORG_UNIT_PAGE,
    to: '/organization',
    labelKey: 'menu.organization',
    testId: 'menu-organization',
    icon: 'grid',
    group: NavGroupKey.PEOPLE,
    order: 350,
  });
}
