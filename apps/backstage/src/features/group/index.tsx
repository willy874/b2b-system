import * as Pages from './pages';
import * as Routes from './routes';

Routes.GroupListRoute.update({ component: Pages.AsyncGroupListPage });
Routes.GroupCreateRoute.update({ component: Pages.AsyncGroupCreatePage });
Routes.GroupDetailRoute.update({ component: Pages.AsyncGroupDetailPage });

export { Routes };
export { GROUP_CREATE_PAGE, GROUP_PAGE, registerGroupPagePermissions } from './permission';
export { appContextPlugin as groupFeaturePlugin } from './plugin';
