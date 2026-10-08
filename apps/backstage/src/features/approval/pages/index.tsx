import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncApprovalListPage = lazyRouteComponent(() => import('./ApprovalList/page'));
export const AsyncApprovalDetailPage = lazyRouteComponent(() => import('./ApprovalDetail/page'));
export const AsyncMyApprovalListPage = lazyRouteComponent(() => import('./MyApprovalList/page'));
export const AsyncMyApprovalDetailPage = lazyRouteComponent(
  () => import('./MyApprovalDetail/page'),
);
