import { localeScopeLoader } from '@b2b-system/web-core/locales';
import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute } from '@tanstack/react-router';

import { AUTH_LOCALE_SCOPE } from '../locale';
import { LoginSearchSchema, SsoCallbackSearchSchema } from './model';

/** feature 的入口 route 必須直掛 RootRoute 且用絕對路徑（routeBasePath 依賴這一點）。 */
export const AuthRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/auth',
  loader: localeScopeLoader(AUTH_LOCALE_SCOPE),
});

/** 登入改由 apps/platform 的 IdP 處理：這一頁只負責跳轉過去（docs/architecture/04-sso.md §12）。 */
export const LoginRoute = createRoute({
  getParentRoute: () => AuthRoute,
  path: 'login',
  staticData: { titleKey: 'auth.login.title' },
  validateSearch: LoginSearchSchema,
});

/** IdP 帶授權碼跳回來的地方（與 api 登記的 redirect URI 一致）。 */
export const SsoCallbackRoute = createRoute({
  getParentRoute: () => AuthRoute,
  path: 'callback',
  staticData: { titleKey: 'auth.callback.title' },
  validateSearch: SsoCallbackSearchSchema,
});
