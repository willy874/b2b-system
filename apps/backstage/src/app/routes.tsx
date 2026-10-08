import { RootRoute } from '@b2b-system/web-core/router';

import { Routes as AccountRoutes } from '@/features/account';
import { Routes as AnnouncementRoutes } from '@/features/announcement';
import { Routes as ApprovalRoutes } from '@/features/approval';
import { Routes as ApprovalFlowRoutes } from '@/features/approval-flow';
import { Routes as AuditLogRoutes } from '@/features/audit-log';
import { Routes as AuthRoutes } from '@/features/auth';
import { Routes as DataTransferRoutes } from '@/features/data-transfer';
import { Routes as FileRoutes } from '@/features/file';
import { Routes as GroupRoutes } from '@/features/group';
import { Routes as HomeRoutes } from '@/features/home';
import { Routes as IdentityProviderRoutes } from '@/features/identity-provider';
import { Routes as JobRoutes } from '@/features/job';
import { Routes as NotificationRoutes } from '@/features/notification';
import { Routes as OrganizationRoutes } from '@/features/organization';
import { Routes as PermissionRoutes } from '@/features/permission';
import { Routes as RoleRoutes } from '@/features/role';
import { Routes as SecurityRoutes } from '@/features/security';
import { Routes as ServiceAccountRoutes } from '@/features/service-account';
import { Routes as SystemRoutes } from '@/features/system';
import { Routes as TagRoutes } from '@/features/tag';
import { Routes as TrashRoutes } from '@/features/trash';
import { Routes as UserRoutes } from '@/features/user';
import { Routes as WebhookRoutes } from '@/features/webhook';

import { Layout } from './Layout';

RootRoute.update({ component: Layout });

/** 只組裝，不實作業務。 */
export const routeTree = RootRoute.addChildren([
  HomeRoutes.HomeRoute,

  AuthRoutes.AuthRoute.addChildren([AuthRoutes.LoginRoute, AuthRoutes.SsoCallbackRoute]),

  UserRoutes.UserListRoute.addChildren([UserRoutes.UserCreateRoute, UserRoutes.UserDetailRoute]),
  UserRoutes.UserImportRoute,

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
  OrganizationRoutes.OrganizationRoute,

  ServiceAccountRoutes.ServiceAccountListRoute.addChildren([
    ServiceAccountRoutes.ServiceAccountCreateRoute,
    ServiceAccountRoutes.ServiceAccountDetailRoute,
  ]),

  PermissionRoutes.PermissionListRoute,
  TagRoutes.TagListRoute,
  AuditLogRoutes.AuditLogListRoute,
  ApprovalRoutes.ApprovalListRoute.addChildren([ApprovalRoutes.ApprovalDetailRoute]),
  ApprovalRoutes.MyApprovalRoute.addChildren([ApprovalRoutes.MyApprovalDetailRoute]),
  ApprovalFlowRoutes.ApprovalFlowListRoute,
  ApprovalFlowRoutes.ApprovalFlowEditRoute,
  FileRoutes.FileListRoute,
  JobRoutes.JobListRoute,
  IdentityProviderRoutes.IdentityProviderListRoute,
  WebhookRoutes.WebhookListRoute.addChildren([
    WebhookRoutes.WebhookCreateRoute,
    WebhookRoutes.WebhookDetailRoute,
  ]),
  AnnouncementRoutes.AnnouncementListRoute.addChildren([
    AnnouncementRoutes.AnnouncementCreateRoute,
    AnnouncementRoutes.AnnouncementDetailRoute,
  ]),
  AnnouncementRoutes.AnnouncementMessageRoute,
  SystemRoutes.SystemRoute,
  SystemRoutes.SettingListRoute,
  SecurityRoutes.SecurityMfaRoute,
  TrashRoutes.TrashListRoute,
  AccountRoutes.ProfileRoute,
  AccountRoutes.PreferenceRoute,
  NotificationRoutes.NotificationListRoute,
  NotificationRoutes.NotificationEventListRoute,
  NotificationRoutes.NotificationOverviewRoute,
  DataTransferRoutes.DataTransferListRoute,
]);
