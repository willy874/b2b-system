import { registerNavItem } from '@b2b-system/web-core/navigation';

import { NavGroupKey } from '@/core/navigation';

import { APPROVAL_PAGE, MY_APPROVAL_PAGE } from './permission';

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
  // 待我審核與我送出的申請：每個登入的人都用得到（docs/architecture/backend/20-approval.md §9.16）
  registerNavItem({
    pageKey: MY_APPROVAL_PAGE,
    to: '/my-approvals',
    labelKey: 'menu.myApproval',
    testId: 'menu-my-approval',
    icon: 'flag',
    group: NavGroupKey.FEATURE,
    order: 50,
  });
}
