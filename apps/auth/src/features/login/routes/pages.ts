import { createRoute } from '@tanstack/react-router';

import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';

import { LOGIN_LOCALE_SCOPE } from '../locale';
import {
  LoginSearchSchema,
  SsoCallbackSearchSchema,
  SsoErrorSearchSchema,
  TokenSearchSchema,
} from './model';

/**
 * apps/auth 自己的頁面也經 SSO 登入（docs/adr/0019-sso-identity-platform.md）：這一頁只負責跳到 IdP。
 * feature 的入口 route 必須直掛 RootRoute 且用絕對路徑（routeBasePath 依賴這一點）。
 */
export const LoginRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/login',
  loader: localeScopeLoader(LOGIN_LOCALE_SCOPE),
  validateSearch: LoginSearchSchema,
});

/** IdP 帶授權碼跳回來的地方（與 api 登記的 redirect URI 一致）。 */
export const SsoCallbackRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/callback',
  loader: localeScopeLoader(LOGIN_LOCALE_SCOPE),
  validateSearch: SsoCallbackSearchSchema,
});

/**
 * IdP 的登入互動頁：provider 先轉到 api 的 `/api/oidc-interaction/:uid`（設互動 cookie 的路徑），
 * 再 302 到這裡。
 */
export const InteractionRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/interaction/$uid',
  loader: localeScopeLoader(LOGIN_LOCALE_SCOPE),
  // 外部 IdP 登入失敗時 api 帶錯誤碼回到這一頁（例：AUTH_SSO_ACCOUNT_NOT_FOUND）
  validateSearch: SsoErrorSearchSchema,
});

export const SsoErrorRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/error',
  loader: localeScopeLoader(LOGIN_LOCALE_SCOPE),
  validateSearch: SsoErrorSearchSchema,
});

// ── 帳號流程（docs/adr/0019-sso-identity-platform.md D1）：帳號屬於平台，信中連結以 AUTH_APP_URL 開頭 ──

export const ForgotPasswordRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/forgot-password',
  loader: localeScopeLoader(LOGIN_LOCALE_SCOPE),
});

export const ResetPasswordRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/reset-password',
  loader: localeScopeLoader(LOGIN_LOCALE_SCOPE),
  validateSearch: TokenSearchSchema,
});

/** 啟用：管理員建立的帳號設定初始密碼。 */
export const SetupRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/setup',
  loader: localeScopeLoader(LOGIN_LOCALE_SCOPE),
  validateSearch: TokenSearchSchema,
});

/** 註冊申請；核准前不會建立帳號（docs/rbac/06-approval.md §5）。 */
export const RegisterRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/register',
  loader: localeScopeLoader(LOGIN_LOCALE_SCOPE),
});
