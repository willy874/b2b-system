import * as Pages from './pages';
import * as Routes from './routes';

Routes.SystemRoute.update({ component: Pages.AsyncSystemIndexPage });
Routes.SettingListRoute.update({ component: Pages.AsyncSettingListPage });

export { Routes };
export { SYSTEM_SETTING_FEATURE } from './routes';
export {
  registerSettingPagePermissions,
  registerSystemPagePermissions,
  SETTING_PAGE,
  SYSTEM_PAGE,
} from './permission';
export {
  appContextPlugin as systemFeaturePlugin,
  settingPlugin as systemSettingFeaturePlugin,
} from './plugin';
export { registerSettingTab, registerSystemNavigation } from './navigation';
