import { RootRoute } from '@/core/router';
import { Routes as AccountRoutes } from '@/features/account';
import { Routes as AuditLogRoutes } from '@/features/audit-log';
import { Routes as AuthRoutes } from '@/features/auth';
import { Routes as HomeRoutes } from '@/features/home';
import { Routes as PermissionRoutes } from '@/features/permission';
import { Routes as RoleRoutes } from '@/features/role';
import { Routes as UserRoutes } from '@/features/user';

import { Layout } from './Layout';

RootRoute.update({ component: Layout });

/** 只組裝，不實作業務。 */
export const routeTree = RootRoute.addChildren([
  HomeRoutes.HomeRoute,

  AuthRoutes.AuthRoute.addChildren([
    AuthRoutes.LoginRoute,
    AuthRoutes.ForgotPasswordRoute,
    AuthRoutes.ResetPasswordRoute,
    AuthRoutes.SetupRoute,
  ]),

  UserRoutes.UserListRoute.addChildren([UserRoutes.UserCreateRoute, UserRoutes.UserDetailRoute]),

  RoleRoutes.RoleListRoute.addChildren([
    RoleRoutes.RoleCreateRoute,
    RoleRoutes.RoleDetailRoute.addChildren([RoleRoutes.RoleDetailPermissionRoute]),
  ]),

  PermissionRoutes.PermissionListRoute,
  AuditLogRoutes.AuditLogListRoute,
  AccountRoutes.ProfileRoute,
  AccountRoutes.PreferenceRoute,
]);
