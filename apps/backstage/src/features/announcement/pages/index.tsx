import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncAnnouncementListPage = lazyRouteComponent(
  () => import('./AnnouncementList/page'),
);
export const AsyncAnnouncementCreatePage = lazyRouteComponent(
  () => import('./AnnouncementCreate/page'),
);
export const AsyncAnnouncementDetailPage = lazyRouteComponent(
  () => import('./AnnouncementDetail/page'),
);
export const AsyncAnnouncementMessagePage = lazyRouteComponent(
  () => import('./AnnouncementMessage/page'),
);
