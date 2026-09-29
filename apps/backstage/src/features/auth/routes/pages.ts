import { createRoute } from '@tanstack/react-router';

import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';

import { AUTH_LOCALE_SCOPE } from '../locale';
import { LoginSearchSchema, TokenSearchSchema } from './model';

/** feature 的入口 route 必須直掛 RootRoute 且用絕對路徑（routeBasePath 依賴這一點）。 */
export const AuthRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/auth',
  loader: localeScopeLoader(AUTH_LOCALE_SCOPE),
});

export const LoginRoute = createRoute({
  getParentRoute: () => AuthRoute,
  path: 'login',
  validateSearch: LoginSearchSchema,
});

export const ForgotPasswordRoute = createRoute({
  getParentRoute: () => AuthRoute,
  path: 'forgot-password',
});

export const ResetPasswordRoute = createRoute({
  getParentRoute: () => AuthRoute,
  path: 'reset-password',
  validateSearch: TokenSearchSchema,
});

/** 註冊申請；核准前不會建立帳號（docs/rbac/06-approval.md §5）。 */
export const RegisterRoute = createRoute({
  getParentRoute: () => AuthRoute,
  path: 'register',
});

export const SetupRoute = createRoute({
  getParentRoute: () => AuthRoute,
  path: 'setup',
  validateSearch: TokenSearchSchema,
});

/**
 * 接受工作區邀請（docs/adr/0018-workspace-tenancy.md D14）。放在 `/auth` 底下：
 * 受邀者多半還沒登入，而其他頁面沒有 session 時會被導去登入頁、丟掉 `token`。
 */
export const InvitationRoute = createRoute({
  getParentRoute: () => AuthRoute,
  path: 'invitation',
  validateSearch: TokenSearchSchema,
});
