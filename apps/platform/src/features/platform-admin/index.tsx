import * as Pages from './pages';
import * as Routes from './routes';

Routes.PlatformAdminListRoute.update({ component: Pages.AsyncPlatformAdminListPage });

export { Routes };
export { PLATFORM_ADMIN_PAGE, registerPlatformAdminPagePermissions } from './permission';
export { appContextPlugin as platformAdminFeaturePlugin } from './plugin';
export { registerPlatformAdminNavigation } from './navigation';
