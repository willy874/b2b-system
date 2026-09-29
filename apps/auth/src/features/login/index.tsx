import * as Pages from './pages';
import * as Routes from './routes';

Routes.LoginRoute.update({ component: Pages.AsyncLoginPage });
Routes.SsoCallbackRoute.update({ component: Pages.AsyncSsoCallbackPage });
Routes.InteractionRoute.update({ component: Pages.AsyncInteractionPage });
Routes.SsoErrorRoute.update({ component: Pages.AsyncSsoErrorPage });

export { Routes };
export { appContextPlugin as loginFeaturePlugin } from './plugin';
export { useSyncPermissions } from './hooks/useSyncPermissions';
export { useLogoutMutation } from './hooks/useLogoutMutation';
