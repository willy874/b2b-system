import * as Pages from './pages';
import * as Routes from './routes';

Routes.NotificationListRoute.update({ component: Pages.AsyncNotificationListPage });

export { Routes };
export { NOTIFICATION_PAGE, registerNotificationPagePermissions } from './permission';
export { appContextPlugin as notificationFeaturePlugin } from './plugin';
