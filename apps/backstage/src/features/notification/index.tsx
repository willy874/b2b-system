import * as Pages from './pages';
import * as Routes from './routes';

Routes.NotificationListRoute.update({ component: Pages.AsyncNotificationListPage });
Routes.NotificationEventListRoute.update({ component: Pages.AsyncNotificationEventListPage });
Routes.NotificationOverviewRoute.update({ component: Pages.AsyncNotificationOverviewPage });

export { Routes };
export {
  NOTIFICATION_EVENT_PAGE,
  NOTIFICATION_OVERVIEW_PAGE,
  NOTIFICATION_PAGE,
  registerNotificationPagePermissions,
} from './permission';
export { appContextPlugin as notificationFeaturePlugin } from './plugin';
export { registerNotificationNavigation } from './navigation';
