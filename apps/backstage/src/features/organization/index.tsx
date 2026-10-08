import * as Pages from './pages';
import * as Routes from './routes';

Routes.OrganizationRoute.update({ component: Pages.AsyncOrganizationPage });
Routes.OrgUnitImportRoute.update({ component: Pages.AsyncOrgUnitImportPage });
Routes.OrgUnitMemberImportRoute.update({ component: Pages.AsyncOrgUnitMemberImportPage });

export { Routes };
export { ORGANIZATION_FEATURE } from './routes';
export {
  ORG_UNIT_IMPORT_PAGE,
  ORG_UNIT_MEMBER_IMPORT_PAGE,
  ORG_UNIT_PAGE,
  registerOrganizationPagePermissions,
} from './permission';
export { appContextPlugin as organizationFeaturePlugin } from './plugin';
export { registerOrganizationNavigation } from './navigation';
