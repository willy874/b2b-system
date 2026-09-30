import * as Pages from './pages';
import * as Routes from './routes';

Routes.PermissionListRoute.update({ component: Pages.AsyncPermissionListPage });

export { Routes };
export { PERMISSION_PAGE, registerPermissionPagePermissions } from './permission';
export { appContextPlugin as permissionFeaturePlugin } from './plugin';
