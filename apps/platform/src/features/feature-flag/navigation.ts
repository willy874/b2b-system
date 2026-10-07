import { registerNavItem } from '@b2b-system/web-core/navigation';

import { NavGroupKey } from '@/core/navigation';

import { FEATURE_FLAG_PAGE } from './permission';

/** 側欄的入口；命令面板的「頁面」也列出它（docs/architecture/frontend/18-command-palette.md §2）。 */
export function registerFeatureFlagNavigation(): void {
  registerNavItem({
    pageKey: FEATURE_FLAG_PAGE,
    to: '/feature-flag',
    labelKey: 'menu.featureFlag',
    testId: 'menu-feature-flag',
    icon: 'pin',
    group: NavGroupKey.TENANT,
    order: 200,
  });
}
