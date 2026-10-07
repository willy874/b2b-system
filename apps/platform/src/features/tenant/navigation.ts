import { registerNavItem } from '@b2b-system/web-core/navigation';

import { NavGroupKey } from '@/core/navigation';

import { TENANT_PAGE } from './permission';

/** 側欄的入口；命令面板的「頁面」也列出它（docs/architecture/frontend/18-command-palette.md §2）。 */
export function registerTenantNavigation(): void {
  registerNavItem({
    pageKey: TENANT_PAGE,
    to: '/tenant',
    labelKey: 'menu.tenant',
    testId: 'menu-tenant',
    icon: 'network',
    group: NavGroupKey.TENANT,
    order: 100,
  });
}
