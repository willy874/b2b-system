import { RootRoute } from '@/core/router';
import { Routes as HomeRoutes } from '@/features/home';
import { Routes as LoginRoutes } from '@/features/login';

import { Layout } from './Layout';

RootRoute.update({ component: Layout });

/** 只組裝，不實作業務。 */
export const routeTree = RootRoute.addChildren([
  HomeRoutes.HomeRoute,
  LoginRoutes.LoginRoute,
  LoginRoutes.SsoCallbackRoute,
  LoginRoutes.InteractionRoute,
  LoginRoutes.SsoErrorRoute,
  LoginRoutes.ForgotPasswordRoute,
  LoginRoutes.ResetPasswordRoute,
  LoginRoutes.SetupRoute,
  LoginRoutes.RegisterRoute,
  LoginRoutes.InvitationRoute,
]);
