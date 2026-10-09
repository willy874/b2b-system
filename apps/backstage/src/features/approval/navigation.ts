import { registerNavItem } from '@b2b-system/web-core/navigation';

import { NavGroupKey } from '@/core/navigation';

import { useAssignedApprovalCount, usePendingApprovalCount } from './hooks/useApprovalCounts';
import { APPROVAL_PAGE, MY_APPROVAL_PAGE } from './permission';

/**
 * 側欄「人員管理」的入口，排在權限（500）之後；命令面板的「頁面」也列出它（docs/architecture/frontend/18-command-palette.md §2）。
 * 兩個入口都帶待審數的徽章（docs/architecture/frontend/02-plugin-system.md §4.6）。
 */
export function registerApprovalNavigation(): void {
  registerNavItem({
    pageKey: APPROVAL_PAGE,
    to: '/approval',
    labelKey: 'menu.approval',
    testId: 'menu-approval',
    icon: 'check',
    group: NavGroupKey.PEOPLE,
    order: 600,
    // 全部的待審（docs/architecture/backend/20-approval.md §11.1）
    useBadge: usePendingApprovalCount,
  });
  // 待我審核與我送出的申請：每個登入的人都用得到（docs/architecture/backend/20-approval.md §9.16）
  registerNavItem({
    pageKey: MY_APPROVAL_PAGE,
    to: '/my-approvals',
    labelKey: 'menu.myApproval',
    testId: 'menu-my-approval',
    icon: 'flag',
    group: NavGroupKey.PEOPLE,
    order: 650,
    useBadge: useAssignedApprovalCount,
  });
}
