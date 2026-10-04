import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncPlatformAdminListPage = lazyRouteComponent(
  () => import('./PlatformAdminList/page'),
);
