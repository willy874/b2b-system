import * as Pages from './pages';
import * as Routes from './routes';

Routes.FeatureFlagListRoute.update({ component: Pages.AsyncFeatureFlagListPage });

export { Routes };
export { FEATURE_FLAG_PAGE, registerFeatureFlagPagePermissions } from './permission';
export { appContextPlugin as featureFlagFeaturePlugin } from './plugin';
