import * as Pages from './pages';
import * as Routes from './routes';

Routes.FileListRoute.update({ component: Pages.AsyncFileManagerPage });

export { Routes };
export { FILE_PAGE, registerFilePagePermissions } from './permission';
export { appContextPlugin as fileFeaturePlugin } from './plugin';
