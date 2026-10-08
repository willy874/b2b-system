import * as Pages from './pages';
import * as Routes from './routes';

Routes.GroupListRoute.update({ component: Pages.AsyncGroupListPage });
Routes.GroupCreateRoute.update({ component: Pages.AsyncGroupCreatePage });
Routes.GroupDetailRoute.update({ component: Pages.AsyncGroupDetailPage });
Routes.GroupImportRoute.update({ component: Pages.AsyncGroupImportPage });
Routes.GroupMemberImportRoute.update({ component: Pages.AsyncGroupMemberImportPage });

export { Routes };
export { GROUP_FEATURE } from './routes';
export {
  GROUP_CREATE_PAGE,
  GROUP_IMPORT_PAGE,
  GROUP_MEMBER_IMPORT_PAGE,
  GROUP_PAGE,
  registerGroupPagePermissions,
} from './permission';
export { appContextPlugin as groupFeaturePlugin } from './plugin';
export { registerGroupNavigation } from './navigation';
