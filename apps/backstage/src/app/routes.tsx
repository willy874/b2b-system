import { createRoute, redirect } from '@tanstack/react-router';

import { RootRoute } from '@/core/router';
import { Routes as AccountRoutes } from '@/features/account';
import { Routes as ApprovalRoutes } from '@/features/approval';
import { Routes as AuditLogRoutes } from '@/features/audit-log';
import { Routes as AuthRoutes } from '@/features/auth';
import { Routes as FileRoutes } from '@/features/file';
import { Routes as HomeRoutes } from '@/features/home';
import { Routes as JobRoutes } from '@/features/job';
import { Routes as PermissionRoutes } from '@/features/permission';
import { Routes as RoleRoutes } from '@/features/role';
import { Routes as UserRoutes } from '@/features/user';
import { Routes as WorkspaceRoutes } from '@/features/workspace';

import { Layout } from './Layout';

RootRoute.update({ component: Layout });

/** `/w/:workspaceSlug` 本身沒有內容：進到工作區的預設頁（檔案管理器）。 */
const WorkspaceIndexRoute = createRoute({
  getParentRoute: () => WorkspaceRoutes.WorkspaceRoute,
  path: '/',
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/w/$workspaceSlug/file',
      params: { workspaceSlug: (params as { workspaceSlug: string }).workspaceSlug },
      replace: true,
    });
  },
});

/** 只組裝，不實作業務。 */
export const routeTree = RootRoute.addChildren([
  HomeRoutes.HomeRoute,

  AuthRoutes.AuthRoute.addChildren([
    AuthRoutes.LoginRoute,
    AuthRoutes.SsoCallbackRoute,
    AuthRoutes.ForgotPasswordRoute,
    AuthRoutes.ResetPasswordRoute,
    AuthRoutes.SetupRoute,
    AuthRoutes.RegisterRoute,
    AuthRoutes.InvitationRoute,
  ]),

  UserRoutes.UserListRoute.addChildren([UserRoutes.UserCreateRoute, UserRoutes.UserDetailRoute]),

  RoleRoutes.RoleListRoute.addChildren([
    RoleRoutes.RoleCreateRoute,
    RoleRoutes.RoleDetailRoute.addChildren([RoleRoutes.RoleDetailPermissionRoute]),
  ]),

  PermissionRoutes.PermissionListRoute,
  AuditLogRoutes.AuditLogListRoute,
  ApprovalRoutes.ApprovalListRoute.addChildren([ApprovalRoutes.ApprovalDetailRoute]),
  WorkspaceRoutes.WorkspaceRoute.addChildren([
    WorkspaceIndexRoute,
    FileRoutes.FileListRoute,
    WorkspaceRoutes.WorkspaceMembersRoute,
  ]),
  WorkspaceRoutes.WorkspaceAdminListRoute,
  JobRoutes.JobListRoute,
  AccountRoutes.ProfileRoute,
  AccountRoutes.PreferenceRoute,
]);
