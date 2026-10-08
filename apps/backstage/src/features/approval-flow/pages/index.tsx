import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncApprovalFlowListPage = lazyRouteComponent(
  () => import('./ApprovalFlowList/page'),
);
export const AsyncApprovalFlowEditPage = lazyRouteComponent(
  () => import('./ApprovalFlowEdit/page'),
);
