import { registerNavItem } from '@b2b-system/web-core/navigation';

import { NavGroupKey } from '@/core/navigation';

import { SECURITY_MFA_PAGE } from './permission';

/** 側欄的入口；命令面板的「頁面」也列出它（docs/architecture/frontend/18-command-palette.md §2）。 */
export function registerSecurityNavigation(): void {
  registerNavItem({
    pageKey: SECURITY_MFA_PAGE,
    to: '/security/mfa',
    labelKey: 'menu.security',
    testId: 'menu-security',
    icon: 'shield',
    group: NavGroupKey.SYSTEM,
    order: 850,
  });
}
