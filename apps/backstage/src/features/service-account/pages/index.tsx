import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncServiceAccountListPage = lazyRouteComponent(
  () => import('./ServiceAccountList/page'),
);
export const AsyncServiceAccountCreatePage = lazyRouteComponent(
  () => import('./ServiceAccountCreate/page'),
);
export const AsyncServiceAccountDetailPage = lazyRouteComponent(
  () => import('./ServiceAccountDetail/page'),
);
