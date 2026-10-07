import * as Pages from './pages';
import * as Routes from './routes';

Routes.TagListRoute.update({ component: Pages.AsyncTagListPage });

export { Routes };
export { registerTagPagePermissions, TAG_PAGE } from './permission';
export { appContextPlugin as tagFeaturePlugin } from './plugin';
export { registerTagNavigation } from './navigation';
