import { localeScopeLoader } from '@b2b-system/web-core/locales';
import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute } from '@tanstack/react-router';

import { LOGIN_LOCALE_SCOPE } from '../locale';
import {
  LoginSearchSchema,
  SsoCallbackSearchSchema,
  SsoErrorSearchSchema,
  TenantSearchSchema,
  TokenSearchSchema,
} from './model';

/**
 * apps/platform 自己的頁面也經 SSO 登入（docs/architecture/04-sso.md §12）：這一頁只負責跳到 IdP。
 * feature 的入口 route 必須直掛 RootRoute 且用絕對路徑（routeBasePath 依賴這一點）。
 */
export const LoginRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/login',
  staticData: { titleKey: 'login.title' },
  loader: localeScopeLoader(LOGIN_LOCALE_SCOPE),
  validateSearch: LoginSearchSchema,
});

/** IdP 帶授權碼跳回來的地方（與 api 登記的 redirect URI 一致）。 */
export const SsoCallbackRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/callback',
  staticData: { titleKey: 'login.callback.title' },
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
  staticData: { titleKey: 'login.title' },
  loader: localeScopeLoader(LOGIN_LOCALE_SCOPE),
  // 外部 IdP 登入失敗時 api 帶錯誤碼回到這一頁（例：AUTH_SSO_ACCOUNT_NOT_FOUND）
  validateSearch: SsoErrorSearchSchema,
});

export const SsoErrorRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/error',
  staticData: { titleKey: 'login.error.title' },
  loader: localeScopeLoader(LOGIN_LOCALE_SCOPE),
  validateSearch: SsoErrorSearchSchema,
});

/**
 * 進入租戶（docs/architecture/05-tenancy.md §10.2 D11）：輸入代碼 → 前往那個租戶的 backstage 登入。
 * `?tenant=` 帶了代碼就直接前往。
 */
export const EnterTenantRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/enter',
  staticData: { titleKey: 'login.enterTenant.title' },
  loader: localeScopeLoader(LOGIN_LOCALE_SCOPE),
  validateSearch: TenantSearchSchema,
});

// ── 帳號流程（docs/architecture/04-sso.md §12.2 D1）：頁面在 apps/platform、信中連結以 PLATFORM_APP_URL 開頭；
// 帳號屬於某個租戶，網址帶 `?tenant=`（docs/architecture/05-tenancy.md §10）──

export const ForgotPasswordRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/forgot-password',
  staticData: { titleKey: 'login.forgotPassword.title' },
  loader: localeScopeLoader(LOGIN_LOCALE_SCOPE),
  validateSearch: TenantSearchSchema,
});

export const ResetPasswordRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/reset-password',
  staticData: { titleKey: 'login.resetPassword.title' },
  loader: localeScopeLoader(LOGIN_LOCALE_SCOPE),
  validateSearch: TokenSearchSchema,
});

/** 啟用：管理員建立的帳號設定初始密碼。 */
export const SetupRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/setup',
  staticData: { titleKey: 'login.setup.title' },
  loader: localeScopeLoader(LOGIN_LOCALE_SCOPE),
  validateSearch: TokenSearchSchema,
});

/** 註冊申請；核准前不會建立帳號（docs/rbac/06-approval.md §5）。 */
export const RegisterRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/register',
  staticData: { titleKey: 'login.register.title' },
  loader: localeScopeLoader(LOGIN_LOCALE_SCOPE),
  validateSearch: TenantSearchSchema,
});
