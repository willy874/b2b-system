import { lazyRouteComponent } from '@tanstack/react-router';

export { WorkspaceLayout } from './WorkspaceLayout/WorkspaceLayout';

export const AsyncWorkspaceMembersPage = lazyRouteComponent(
  () => import('./WorkspaceMembers/page'),
);
/** 平台的工作區管理搬到 apps/auth：舊網址轉過去（docs/adr/0019-sso-identity-platform.md D13）。 */
export const AsyncWorkspaceAdminMovedPage = lazyRouteComponent(
  () => import('./WorkspaceAdminMoved/page'),
);
