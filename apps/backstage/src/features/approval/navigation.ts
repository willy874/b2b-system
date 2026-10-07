import { registerNavItem } from '@b2b-system/web-core/navigation';

import { NavGroupKey } from '@/core/navigation';

import { APPROVAL_PAGE } from './permission';

/** 側欄的入口；命令面板的「頁面」也列出它（docs/architecture/frontend/18-command-palette.md §2）。 */
export function registerApprovalNavigation(): void {
  registerNavItem({
    pageKey: APPROVAL_PAGE,
    to: '/approval',
    labelKey: 'menu.approval',
    testId: 'menu-approval',
    icon: 'check',
    group: NavGroupKey.SYSTEM,
    order: 200,
  });
}
