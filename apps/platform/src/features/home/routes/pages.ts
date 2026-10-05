import { localeScopeLoader } from '@b2b-system/web-core/locales';
import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute } from '@tanstack/react-router';

import { HOME_LOCALE_SCOPE } from '../locale';

export const HomeRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/',
  loader: localeScopeLoader(HOME_LOCALE_SCOPE),
});
