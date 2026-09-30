import * as Pages from './pages';
import * as Routes from './routes';

Routes.LoginRoute.update({ component: Pages.AsyncLoginPage });
Routes.SsoCallbackRoute.update({ component: Pages.AsyncSsoCallbackPage });

export { Routes };
export { appContextPlugin as authFeaturePlugin } from './plugin';
export { useSyncPermissions } from './hooks/useSyncPermissions';
export { useLogoutMutation } from './hooks/useLogoutMutation';
export { LOGOUT_REASON, PASSWORD_CHANGED_REASON, sessionEndMessageKey } from './sessionEnd';
