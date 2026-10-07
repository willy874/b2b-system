import { registerNavItem } from '@b2b-system/web-core/navigation';

import { NavGroupKey } from '@/core/navigation';

import { MFA_METHOD_PAGE } from './permission';

/** 側欄的入口；命令面板的「頁面」也列出它（docs/architecture/frontend/18-command-palette.md §2）。 */
export function registerMfaMethodNavigation(): void {
  registerNavItem({
    pageKey: MFA_METHOD_PAGE,
    to: '/mfa-method',
    labelKey: 'menu.mfaMethod',
    testId: 'menu-mfa-method',
    icon: 'shield',
    group: NavGroupKey.TENANT,
    order: 250,
  });
}
