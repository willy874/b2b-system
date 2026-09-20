import { createRoute } from '@tanstack/react-router';

import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';

import { USER_LOCALE_SCOPE } from '../locale';
import { UserSearchQuerySchema } from './model';

export const UserListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/user',
  loader: localeScopeLoader(USER_LOCALE_SCOPE),
  validateSearch: UserSearchQuerySchema,
});

export const UserCreateRoute = createRoute({
  getParentRoute: () => UserListRoute,
  path: 'create',
  validateSearch: UserSearchQuerySchema,
});

export const UserDetailRoute = createRoute({
  getParentRoute: () => UserListRoute,
  path: '$userId',
});
