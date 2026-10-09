import * as Pages from './pages';
import * as Routes from './routes';

Routes.CdnRoute.update({ component: Pages.AsyncCdnOverviewPage });

export { Routes };
export { CDN_PAGE, registerCdnPagePermissions } from './permission';
export { appContextPlugin as cdnFeaturePlugin } from './plugin';
export { registerCdnNavigation } from './navigation';
