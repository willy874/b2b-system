import * as Pages from './pages';
import * as Routes from './routes';

Routes.TrashListRoute.update({ component: Pages.AsyncTrashListPage });

export { Routes };
export { registerTrashPagePermissions, TRASH_PAGE } from './permission';
export { appContextPlugin as trashFeaturePlugin } from './plugin';
