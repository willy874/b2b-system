import { createRoute } from '@tanstack/react-router';

import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';

import { PERMISSION_LOCALE_SCOPE } from '../locale';

export const PermissionListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/permission',
  loader: localeScopeLoader(PERMISSION_LOCALE_SCOPE),
});
