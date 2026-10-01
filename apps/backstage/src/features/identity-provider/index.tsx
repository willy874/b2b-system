import * as Pages from './pages';
import * as Routes from './routes';

Routes.IdentityProviderListRoute.update({ component: Pages.AsyncIdentityProviderListPage });

export { Routes };
export { IDENTITY_PROVIDER_FEATURE } from './routes';
export { IDENTITY_PROVIDER_PAGE, registerIdentityProviderPagePermissions } from './permission';
export { appContextPlugin as identityProviderFeaturePlugin } from './plugin';
