import { registerNavItem } from '@b2b-system/web-core/navigation';

import { NavGroupKey } from '@/core/navigation';

import { IDENTITY_PROVIDER_PAGE } from './permission';

/** 側欄的入口；命令面板的「頁面」也列出它（docs/architecture/frontend/18-command-palette.md §2）。 */
export function registerIdentityProviderNavigation(): void {
  registerNavItem({
    pageKey: IDENTITY_PROVIDER_PAGE,
    to: '/identity-provider',
    labelKey: 'menu.identityProvider',
    testId: 'menu-identity-provider',
    icon: 'log-in',
    group: NavGroupKey.SYSTEM,
    order: 400,
  });
}
