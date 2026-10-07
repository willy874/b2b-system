import * as Pages from './pages';
import * as Routes from './routes';

Routes.TenantListRoute.update({ component: Pages.AsyncTenantListPage });
Routes.TenantDetailRoute.update({ component: Pages.AsyncTenantDetailPage });

export { Routes };
export { registerTenantPagePermissions, TENANT_PAGE } from './permission';
export { appContextPlugin as tenantFeaturePlugin } from './plugin';
export { registerTenantNavigation } from './navigation';
