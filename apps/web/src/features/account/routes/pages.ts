import { createRoute } from '@tanstack/react-router';

import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';

import { ACCOUNT_LOCALE_SCOPE } from '../locale';

export const ProfileRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/profile',
  loader: localeScopeLoader(ACCOUNT_LOCALE_SCOPE),
});

export const PreferenceRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/preference',
  loader: localeScopeLoader(ACCOUNT_LOCALE_SCOPE),
});
