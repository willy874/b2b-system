import { registerNavItem } from '@b2b-system/web-core/navigation';

import { NavGroupKey } from '@/core/navigation';

import { APPROVAL_FLOW_PAGE } from './permission';

/** 側欄「系統管理」的入口；命令面板的「頁面」也列出它（docs/architecture/frontend/18-command-palette.md §2）。 */
export function registerApprovalFlowNavigation(): void {
  registerNavItem({
    pageKey: APPROVAL_FLOW_PAGE,
    to: '/approval-flow',
    labelKey: 'menu.approvalFlow',
    testId: 'menu-approval-flow',
    icon: 'filter',
    group: NavGroupKey.SYSTEM,
    order: 250,
  });
}
