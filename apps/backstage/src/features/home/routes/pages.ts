import { createRoute } from '@tanstack/react-router';

import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';

import { HOME_LOCALE_SCOPE } from '../locale';

export const HomeRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/',
  loader: localeScopeLoader(HOME_LOCALE_SCOPE),
});
