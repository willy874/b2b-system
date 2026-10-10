import { registerRouteLink } from '@b2b-system/web-core/route-link';

import { NotificationOverviewRoute } from './routes/pages';

/**
 * 別的 feature 連到通知總覽用的 route id（docs/architecture/frontend/03-feature-anatomy.md §4.1）：
 * 公告的發送紀錄以 `?sourceId=` 看這次送給了誰、誰還沒讀。沒有 `notification:read` 時 `RouteLink` 只顯示文字。
 */
export function registerNotificationRouteLinks(): void {
  registerRouteLink('notification.overviewBySource', {
    route: NotificationOverviewRoute,
    search: { sourceId: 'sourceId' },
  });
}
