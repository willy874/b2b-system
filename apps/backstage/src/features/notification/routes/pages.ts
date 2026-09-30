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
