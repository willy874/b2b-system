import { createRoute } from '@tanstack/react-router';

import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';

import { LOGIN_LOCALE_SCOPE } from '../locale';
import { LoginSearchSchema } from './model';

/** feature 的入口 route 必須直掛 RootRoute 且用絕對路徑（routeBasePath 依賴這一點）。 */
export const LoginRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/login',
  loader: localeScopeLoader(LOGIN_LOCALE_SCOPE),
  validateSearch: LoginSearchSchema,
});
