import * as Pages from './pages';
import * as Routes from './routes';

Routes.ServiceAccountListRoute.update({ component: Pages.AsyncServiceAccountListPage });
Routes.ServiceAccountCreateRoute.update({ component: Pages.AsyncServiceAccountCreatePage });
Routes.ServiceAccountDetailRoute.update({ component: Pages.AsyncServiceAccountDetailPage });

export { Routes };
export { SERVICE_ACCOUNT_FEATURE } from './routes';
export {
  registerServiceAccountPagePermissions,
  SERVICE_ACCOUNT_CREATE_PAGE,
  SERVICE_ACCOUNT_PAGE,
} from './permission';
export { appContextPlugin as serviceAccountFeaturePlugin } from './plugin';
export { registerServiceAccountNavigation } from './navigation';
