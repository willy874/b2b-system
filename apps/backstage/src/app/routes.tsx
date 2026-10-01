import { RootRoute } from '@/core/router';
import { Routes as AccountRoutes } from '@/features/account';
import { Routes as ApprovalRoutes } from '@/features/approval';
import { Routes as AuditLogRoutes } from '@/features/audit-log';
import { Routes as AuthRoutes } from '@/features/auth';
import { Routes as FileRoutes } from '@/features/file';
import { Routes as GroupRoutes } from '@/features/group';
import { Routes as HomeRoutes } from '@/features/home';
import { Routes as IdentityProviderRoutes } from '@/features/identity-provider';
import { Routes as JobRoutes } from '@/features/job';
import { Routes as NotificationRoutes } from '@/features/notification';
import { Routes as PermissionRoutes } from '@/features/permission';
import { Routes as RoleRoutes } from '@/features/role';
import { Routes as SystemRoutes } from '@/features/system';
import { Routes as TrashRoutes } from '@/features/trash';
import { Routes as UserRoutes } from '@/features/user';

import { Layout } from './Layout';

RootRoute.update({ component: Layout });

/** 只組裝，不實作業務。 */
export const routeTree = RootRoute.addChildren([
  HomeRoutes.HomeRoute,

  AuthRoutes.AuthRoute.addChildren([AuthRoutes.LoginRoute, AuthRoutes.SsoCallbackRoute]),

  UserRoutes.UserListRoute.addChildren([UserRoutes.UserCreateRoute, UserRoutes.UserDetailRoute]),

  RoleRoutes.RoleListRoute.addChildren([
    RoleRoutes.RoleCreateRoute,
    RoleRoutes.RoleDetailRoute.addChildren([
      RoleRoutes.RoleDetailPermissionRoute,
      RoleRoutes.RoleDetailRevisionRoute,
    ]),
  ]),

  GroupRoutes.GroupListRoute.addChildren([
    GroupRoutes.GroupCreateRoute,
    GroupRoutes.GroupDetailRoute,
  ]),

  PermissionRoutes.PermissionListRoute,
  AuditLogRoutes.AuditLogListRoute,
  ApprovalRoutes.ApprovalListRoute.addChildren([ApprovalRoutes.ApprovalDetailRoute]),
  FileRoutes.FileListRoute,
  JobRoutes.JobListRoute,
  IdentityProviderRoutes.IdentityProviderListRoute,
  SystemRoutes.SettingListRoute,
  TrashRoutes.TrashListRoute,
  AccountRoutes.ProfileRoute,
  AccountRoutes.PreferenceRoute,
  NotificationRoutes.NotificationListRoute,
]);
