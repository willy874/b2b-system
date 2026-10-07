import * as Pages from './pages';
import * as Routes from './routes';

Routes.DataTransferListRoute.update({ component: Pages.AsyncDataTransferListPage });

export { Routes };
export { DATA_TRANSFER_FEATURE } from './routes';
export { DATA_TRANSFER_PAGE, registerDataTransferPagePermissions } from './permission';
export { appContextPlugin as dataTransferFeaturePlugin } from './plugin';
