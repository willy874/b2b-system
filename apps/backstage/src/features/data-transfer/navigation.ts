import { registerNavItem } from '@b2b-system/web-core/navigation';

import { DATA_TRANSFER_PAGE } from './permission';

/**
 * 個人的入口（docs/architecture/backend/22-data-transfer.md §8.4「個人」群組）：放在頂列的帳號選單，與個人資料、偏好設定同一處；
 * 所有登入的人都看得到。命令面板的「頁面」也列出它。
 */
export function registerDataTransferNavigation(): void {
  registerNavItem({
    pageKey: DATA_TRANSFER_PAGE,
    to: '/data-transfer',
    labelKey: 'menu.dataTransfer',
    testId: 'menu-data-transfer',
    icon: 'arrow-up-down',
    placement: 'account',
    order: 300,
  });
}
