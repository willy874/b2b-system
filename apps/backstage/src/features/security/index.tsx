import * as Pages from './pages';
import * as Routes from './routes';

Routes.SecurityMfaRoute.update({ component: Pages.AsyncMfaPolicyPage });

export { Routes };
export { registerSecurityPagePermissions, SECURITY_MFA_PAGE } from './permission';
export { appContextPlugin as securityFeaturePlugin } from './plugin';
export { registerSecurityNavigation } from './navigation';
