import * as Pages from './pages';
import * as Routes from './routes';

Routes.LoginRoute.update({ component: Pages.AsyncLoginPage });
Routes.SsoCallbackRoute.update({ component: Pages.AsyncSsoCallbackPage });
Routes.InteractionRoute.update({ component: Pages.AsyncInteractionPage });
Routes.SsoErrorRoute.update({ component: Pages.AsyncSsoErrorPage });
Routes.ForgotPasswordRoute.update({ component: Pages.AsyncForgotPasswordPage });
Routes.ResetPasswordRoute.update({ component: Pages.AsyncResetPasswordPage });
Routes.SetupRoute.update({ component: Pages.AsyncSetupPage });
Routes.RegisterRoute.update({ component: Pages.AsyncRegisterPage });
Routes.InvitationRoute.update({ component: Pages.AsyncInvitationPage });

export { Routes };
export { appContextPlugin as loginFeaturePlugin } from './plugin';
export { useSyncPermissions } from './hooks/useSyncPermissions';
export { useLogoutMutation } from './hooks/useLogoutMutation';
