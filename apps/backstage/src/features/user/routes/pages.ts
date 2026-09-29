import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';

import { USER_LOCALE_SCOPE } from '../locale';
import { DEFAULT_USER_SEARCH, UserSearchQuerySchema } from './model';

export const UserListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/user',
  loader: localeScopeLoader(USER_LOCALE_SCOPE),
  validateSearch: UserSearchQuerySchema,
  // 等於預設值的參數不寫進網址（子路由也套用）
  search: { middlewares: [stripSearchParams(DEFAULT_USER_SEARCH)] },
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
