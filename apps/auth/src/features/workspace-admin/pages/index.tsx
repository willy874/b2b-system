import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncWorkspaceAdminListPage = lazyRouteComponent(
  () => import('./WorkspaceAdminList/page'),
);
