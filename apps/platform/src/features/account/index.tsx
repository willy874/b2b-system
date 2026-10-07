import * as Pages from './pages';
import * as Routes from './routes';

Routes.ProfileRoute.update({ component: Pages.AsyncProfilePage });
Routes.PreferenceRoute.update({ component: Pages.AsyncPreferencePage });

export { Routes };
export { useChangeLocale } from './hooks/useChangeLocale';
export { PREFERENCE_PAGE, PROFILE_PAGE, registerAccountPagePermissions } from './permission';
export { appContextPlugin as accountFeaturePlugin } from './plugin';
export { registerAccountNavigation } from './navigation';
