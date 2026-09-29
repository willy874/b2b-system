import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncLoginPage = lazyRouteComponent(() => import('./Login/page'));
export const AsyncForgotPasswordPage = lazyRouteComponent(() => import('./ForgotPassword/page'));
export const AsyncResetPasswordPage = lazyRouteComponent(() => import('./ResetPassword/page'));
export const AsyncRegisterPage = lazyRouteComponent(() => import('./Register/page'));
export const AsyncSetupPage = lazyRouteComponent(() => import('./Setup/page'));
export const AsyncInvitationPage = lazyRouteComponent(() => import('./Invitation/page'));
export const AsyncSsoCallbackPage = lazyRouteComponent(() => import('./SsoCallback/page'));
