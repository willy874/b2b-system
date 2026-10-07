import { RootRoute } from '@b2b-system/web-core/router';

import { Routes as AccountRoutes } from '@/features/account';
import { Routes as AuditLogRoutes } from '@/features/audit-log';
import { Routes as FeatureFlagRoutes } from '@/features/feature-flag';
import { Routes as HomeRoutes } from '@/features/home';
import { Routes as JobRoutes } from '@/features/job';
import { Routes as LoginRoutes } from '@/features/login';
import { Routes as MfaMethodRoutes } from '@/features/mfa-method';
import { Routes as NotificationRoutes } from '@/features/notification';
import { Routes as PlatformAdminRoutes } from '@/features/platform-admin';
import { Routes as TenantRoutes } from '@/features/tenant';

import { Layout } from './Layout';

RootRoute.update({ component: Layout });

/** 只組裝，不實作業務。 */
export const routeTree = RootRoute.addChildren([
  HomeRoutes.HomeRoute,
  AccountRoutes.ProfileRoute,
  AccountRoutes.PreferenceRoute,
  NotificationRoutes.NotificationListRoute,
  TenantRoutes.TenantListRoute,
  TenantRoutes.TenantDetailRoute,
  PlatformAdminRoutes.PlatformAdminListRoute,
  AuditLogRoutes.AuditLogListRoute,
  JobRoutes.JobListRoute,
  FeatureFlagRoutes.FeatureFlagListRoute,
  MfaMethodRoutes.MfaMethodListRoute,
  LoginRoutes.LoginRoute,
  LoginRoutes.SsoCallbackRoute,
  LoginRoutes.InteractionRoute,
  LoginRoutes.SsoErrorRoute,
  LoginRoutes.ForgotPasswordRoute,
  LoginRoutes.ResetPasswordRoute,
  LoginRoutes.SetupRoute,
  LoginRoutes.RegisterRoute,
  LoginRoutes.EnterTenantRoute,
]);
