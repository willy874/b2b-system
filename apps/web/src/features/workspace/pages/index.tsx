import { lazyRouteComponent } from '@tanstack/react-router';

export { WorkspaceLayout } from './WorkspaceLayout/WorkspaceLayout';

export const AsyncWorkspaceMembersPage = lazyRouteComponent(
  () => import('./WorkspaceMembers/page'),
);
export const AsyncWorkspaceAdminListPage = lazyRouteComponent(
  () => import('./WorkspaceAdminList/page'),
);
