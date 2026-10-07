import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncDataTransferListPage = lazyRouteComponent(
  () => import('./DataTransferList/page'),
);
