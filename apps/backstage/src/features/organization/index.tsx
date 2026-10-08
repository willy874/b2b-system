import * as Pages from './pages';
import * as Routes from './routes';

Routes.OrganizationRoute.update({ component: Pages.AsyncOrganizationPage });

export { Routes };
export { ORGANIZATION_FEATURE } from './routes';
export { ORG_UNIT_PAGE, registerOrganizationPagePermissions } from './permission';
export { appContextPlugin as organizationFeaturePlugin } from './plugin';
export { registerOrganizationNavigation } from './navigation';
