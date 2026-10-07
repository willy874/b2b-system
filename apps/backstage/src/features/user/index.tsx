import * as Pages from './pages';
import * as Routes from './routes';

Routes.UserListRoute.update({ component: Pages.AsyncUserListPage });
Routes.UserCreateRoute.update({ component: Pages.AsyncUserCreatePage });
Routes.UserDetailRoute.update({ component: Pages.AsyncUserDetailPage });
Routes.UserImportRoute.update({ component: Pages.AsyncUserImportPage });

export { Routes };
export {
  USER_CREATE_PAGE,
  USER_IMPORT_PAGE,
  USER_PAGE,
  registerUserPagePermissions,
} from './permission';
export { appContextPlugin as userFeaturePlugin } from './plugin';
export { registerUserNavigation } from './navigation';
