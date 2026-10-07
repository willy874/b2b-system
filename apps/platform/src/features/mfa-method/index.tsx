import * as Pages from './pages';
import * as Routes from './routes';

Routes.MfaMethodListRoute.update({ component: Pages.AsyncMfaMethodListPage });

export { Routes };
export { MFA_METHOD_PAGE, registerMfaMethodPagePermissions } from './permission';
export { appContextPlugin as mfaMethodFeaturePlugin } from './plugin';
export { registerMfaMethodNavigation } from './navigation';
