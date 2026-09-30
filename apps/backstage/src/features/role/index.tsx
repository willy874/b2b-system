import * as Pages from './pages';
import * as Routes from './routes';

Routes.RoleListRoute.update({ component: Pages.AsyncRoleListPage });
Routes.RoleCreateRoute.update({ component: Pages.AsyncRoleCreatePage });
Routes.RoleDetailRoute.update({ component: Pages.AsyncRoleDetailPage });
Routes.RoleDetailPermissionRoute.update({ component: Pages.AsyncRoleDetailPermissionPage });

export { Routes };
export { ROLE_CREATE_PAGE, ROLE_PAGE, registerRolePagePermissions } from './permission';
export { appContextPlugin as roleFeaturePlugin } from './plugin';
