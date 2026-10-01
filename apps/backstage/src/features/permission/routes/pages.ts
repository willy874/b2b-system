import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';

import { PERMISSION_LOCALE_SCOPE } from '../locale';
import { DEFAULT_PERMISSION_SEARCH, PermissionSearchQuerySchema } from './model';

export const PermissionListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/permission',
  loader: localeScopeLoader(PERMISSION_LOCALE_SCOPE),
  validateSearch: PermissionSearchQuerySchema,
  search: { middlewares: [stripSearchParams(DEFAULT_PERMISSION_SEARCH)] },
});
