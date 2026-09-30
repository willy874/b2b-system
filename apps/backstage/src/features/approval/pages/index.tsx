import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncApprovalListPage = lazyRouteComponent(() => import('./ApprovalList/page'));
export const AsyncApprovalDetailPage = lazyRouteComponent(() => import('./ApprovalDetail/page'));
