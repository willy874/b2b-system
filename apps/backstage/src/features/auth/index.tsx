import * as Pages from './pages';
import * as Routes from './routes';

Routes.LoginRoute.update({ component: Pages.AsyncLoginPage });
Routes.SsoCallbackRoute.update({ component: Pages.AsyncSsoCallbackPage });
// 帳號流程搬到 apps/auth：舊網址轉過去（docs/adr/0019-sso-identity-platform.md D1）
Routes.ForgotPasswordRoute.update({ component: Pages.AsyncMovedToAuthAppPage });
Routes.ResetPasswordRoute.update({ component: Pages.AsyncMovedToAuthAppPage });
Routes.SetupRoute.update({ component: Pages.AsyncMovedToAuthAppPage });
Routes.RegisterRoute.update({ component: Pages.AsyncMovedToAuthAppPage });
Routes.InvitationRoute.update({ component: Pages.AsyncMovedToAuthAppPage });

export { Routes };
export { appContextPlugin as authFeaturePlugin } from './plugin';
export { useSyncPermissions } from './hooks/useSyncPermissions';
export { useLogoutMutation } from './hooks/useLogoutMutation';
