import { registerRouteLink } from '@/core/route-link';

import { AnnouncementMessageRoute } from './routes/pages';

/**
 * 後端連結用的 route id（docs/architecture/backend/15-notification.md §4.1）。已發出的 id 不改名：舊通知靠它連結。
 * 這個 feature 是可啟用的：租戶沒啟用時沒有登記，`announcement.published` 的通知只顯示文字、不可點。
 */
export function registerAnnouncementRouteLinks(): void {
  registerRouteLink('announcement.message', {
    route: AnnouncementMessageRoute,
    params: { dispatchId: 'dispatchId' },
  });
}
