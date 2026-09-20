import { lazy } from 'react';

export const AsyncLoginPage = lazy(() => import('./Login/page'));
export const AsyncForgotPasswordPage = lazy(() => import('./ForgotPassword/page'));
export const AsyncResetPasswordPage = lazy(() => import('./ResetPassword/page'));
export const AsyncSetupPage = lazy(() => import('./Setup/page'));
