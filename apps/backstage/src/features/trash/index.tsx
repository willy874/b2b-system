import * as Pages from './pages';
import * as Routes from './routes';

Routes.TrashListRoute.update({ component: Pages.AsyncTrashListPage });

export { Routes };
export { TRASH_FEATURE } from './routes';
export { registerTrashPagePermissions, TRASH_PAGE } from './permission';
export { appContextPlugin as trashFeaturePlugin } from './plugin';
export { registerTrashNavigation } from './navigation';
