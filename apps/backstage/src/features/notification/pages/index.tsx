import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncNotificationListPage = lazyRouteComponent(
  () => import('./NotificationList/page'),
);

export const AsyncNotificationOverviewPage = lazyRouteComponent(
  () => import('./NotificationOverview/page'),
);

export const AsyncNotificationEventListPage = lazyRouteComponent(
  () => import('./NotificationEventList/page'),
);
