import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncLoginPage = lazyRouteComponent(() => import('./Login/page'));
export const AsyncSsoCallbackPage = lazyRouteComponent(() => import('./SsoCallback/page'));
export const AsyncInteractionPage = lazyRouteComponent(() => import('./Interaction/page'));
export const AsyncSsoErrorPage = lazyRouteComponent(() => import('./SsoError/page'));
