import { registerRouteLink } from '@b2b-system/web-core/route-link';

import { DataTransferListRoute } from './routes/pages';

/**
 * 後端連結用的 route id（docs/architecture/backend/15-notification.md §4.1）：匯入匯出完成的通知連到這裡。已發出的 id 不改名。
 * 這個 feature 是可啟用的：租戶沒啟用時沒有登記，通知只顯示文字、不可點。
 */
export function registerDataTransferRouteLinks(): void {
  registerRouteLink('dataTransfer.detail', {
    route: DataTransferListRoute,
    search: { transfer: 'transferId' },
  });
}
