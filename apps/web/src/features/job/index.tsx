import * as Pages from './pages';
import * as Routes from './routes';

Routes.JobListRoute.update({ component: Pages.AsyncJobListPage });

export { Routes };
export { JOB_PAGE, registerJobPagePermissions } from './permission';
export { appContextPlugin as jobFeaturePlugin } from './plugin';
