import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';

import { NOTIFICATION_LOCALE_SCOPE } from '../locale';
import { DEFAULT_NOTIFICATION_SEARCH, NotificationSearchQuerySchema } from './model';

/** 站內通知的完整列表（docs/architecture/frontend/15-notification.md）；頂列鈴鐺的「查看全部」連到這裡。 */
export const NotificationListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/notification',
  loader: localeScopeLoader(NOTIFICATION_LOCALE_SCOPE),
  validateSearch: NotificationSearchQuerySchema,
  search: { middlewares: [stripSearchParams(DEFAULT_NOTIFICATION_SEARCH)] },
});

/**
 * 事件管理（`system:read` 檢視、`system:update` 修改；docs/architecture/frontend/15-notification.md §9、ADR-0028 D12）：
 * 租戶層決定每個事件經由哪些管道送出。
 */
export const NotificationEventListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/notification/events',
  loader: localeScopeLoader(NOTIFICATION_LOCALE_SCOPE),
});
