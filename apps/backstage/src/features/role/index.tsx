import * as Pages from './pages';
import * as Routes from './routes';

Routes.RoleListRoute.update({ component: Pages.AsyncRoleListPage });
Routes.RoleCreateRoute.update({ component: Pages.AsyncRoleCreatePage });
Routes.RoleDetailRoute.update({ component: Pages.AsyncRoleDetailPage });
Routes.RoleDetailPermissionRoute.update({ component: Pages.AsyncRoleDetailPermissionPage });
Routes.RoleDetailRevisionRoute.update({ component: Pages.AsyncRoleDetailRevisionPage });
Routes.RoleImportRoute.update({ component: Pages.AsyncRoleImportPage });

export { Routes };
export {
  ROLE_CREATE_PAGE,
  ROLE_IMPORT_PAGE,
  ROLE_PAGE,
  registerRolePagePermissions,
} from './permission';
export { appContextPlugin as roleFeaturePlugin } from './plugin';
export { registerRoleNavigation } from './navigation';
