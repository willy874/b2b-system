import { localeScopeLoader } from '@b2b-system/web-core/locales';
import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { PERMISSION_LOCALE_SCOPE } from '../locale';
import { DEFAULT_PERMISSION_SEARCH, PermissionSearchQuerySchema } from './model';

export const PermissionListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/permission',
  loader: localeScopeLoader(PERMISSION_LOCALE_SCOPE),
  validateSearch: PermissionSearchQuerySchema,
  search: { middlewares: [stripSearchParams(DEFAULT_PERMISSION_SEARCH)] },
});
