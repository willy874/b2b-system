import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncLoginPage = lazyRouteComponent(() => import('./Login/page'));
export const AsyncSsoCallbackPage = lazyRouteComponent(() => import('./SsoCallback/page'));
