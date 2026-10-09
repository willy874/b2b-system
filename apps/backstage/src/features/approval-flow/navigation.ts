import { registerSystemSettingsTab } from '@/core/system-settings';

import { APPROVAL_FLOW_PAGE } from './permission';

/**
 * 系統設定的「審批流程」分頁（docs/architecture/frontend/02-plugin-system.md §4.5）；側欄只有「系統設定」一個入口。
 * 可啟用的 feature `approvalChain` 未啟用時，頁面鍵不登記，分頁跟著消失。
 */
export function registerApprovalFlowNavigation(): void {
  registerSystemSettingsTab({
    key: 'approval-flows',
    pageKey: APPROVAL_FLOW_PAGE,
    to: '/system/approval-flows',
    labelKey: 'menu.approvalFlow',
    order: 400,
  });
}
