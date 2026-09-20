import * as Pages from './pages';
import * as Routes from './routes';

Routes.LoginRoute.update({ component: Pages.AsyncLoginPage });
Routes.ForgotPasswordRoute.update({ component: Pages.AsyncForgotPasswordPage });
Routes.ResetPasswordRoute.update({ component: Pages.AsyncResetPasswordPage });
Routes.SetupRoute.update({ component: Pages.AsyncSetupPage });

export { Routes };
export { appContextPlugin as authFeaturePlugin } from './plugin';
export { useSyncPermissions } from './hooks/useSyncPermissions';
export { useLogoutMutation } from './hooks/useLogoutMutation';
