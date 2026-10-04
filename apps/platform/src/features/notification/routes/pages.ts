import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';

import { NOTIFICATION_LOCALE_SCOPE } from '../locale';
import { DEFAULT_NOTIFICATION_SEARCH, NotificationSearchQuerySchema } from './model';

export const NotificationListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/notification',
  loader: localeScopeLoader(NOTIFICATION_LOCALE_SCOPE),
  validateSearch: NotificationSearchQuerySchema,
  search: { middlewares: [stripSearchParams(DEFAULT_NOTIFICATION_SEARCH)] },
});
