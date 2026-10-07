import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncSecurityLayout = lazyRouteComponent(() => import('./SecurityLayout/page'));
export const AsyncMfaPolicyPage = lazyRouteComponent(() => import('./MfaPolicy/page'));
