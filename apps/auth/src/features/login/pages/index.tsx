import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncLoginPage = lazyRouteComponent(() => import('./Login/page'));
export const AsyncSsoCallbackPage = lazyRouteComponent(() => import('./SsoCallback/page'));
export const AsyncInteractionPage = lazyRouteComponent(() => import('./Interaction/page'));
export const AsyncSsoErrorPage = lazyRouteComponent(() => import('./SsoError/page'));
export const AsyncForgotPasswordPage = lazyRouteComponent(() => import('./ForgotPassword/page'));
export const AsyncResetPasswordPage = lazyRouteComponent(() => import('./ResetPassword/page'));
export const AsyncSetupPage = lazyRouteComponent(() => import('./Setup/page'));
export const AsyncRegisterPage = lazyRouteComponent(() => import('./Register/page'));
