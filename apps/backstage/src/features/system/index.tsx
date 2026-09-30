import * as Pages from './pages';
import * as Routes from './routes';

Routes.SettingListRoute.update({ component: Pages.AsyncSettingListPage });

export { Routes };
export { registerSystemPagePermissions, SETTING_PAGE } from './permission';
export { appContextPlugin as systemFeaturePlugin } from './plugin';
