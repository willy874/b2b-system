import * as Pages from './pages';
import * as Routes from './routes';

Routes.HomeRoute.update({ component: Pages.AsyncHomePage });

export { Routes };
export { HOME_PAGE, registerHomePagePermissions } from './permission';
export { appContextPlugin as homeFeaturePlugin } from './plugin';
