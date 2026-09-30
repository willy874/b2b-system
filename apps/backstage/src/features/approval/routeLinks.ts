import { registerRouteLink } from '@/core/route-link';

import { ApprovalDetailRoute } from './routes/pages';

/**
 * 後端連結用的 route id（docs/architecture/backend/15-notification.md §4.1）。已發出的 id 不改名：舊通知靠它連結；
 * 頁面搬家時只改這裡的 route。
 */
export function registerApprovalRouteLinks(): void {
  registerRouteLink('approval.detail', {
    route: ApprovalDetailRoute,
    params: { approvalId: 'approvalId' },
  });
}
