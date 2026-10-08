import * as Pages from './pages';
import * as Routes from './routes';

Routes.TagListRoute.update({ component: Pages.AsyncTagListPage });
Routes.TagImportRoute.update({ component: Pages.AsyncTagImportPage });

export { Routes };
export { registerTagPagePermissions, TAG_IMPORT_PAGE, TAG_PAGE } from './permission';
export { appContextPlugin as tagFeaturePlugin } from './plugin';
export { registerTagNavigation } from './navigation';
