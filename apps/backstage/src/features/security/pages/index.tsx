import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncMfaPolicyPage = lazyRouteComponent(() => import('./MfaPolicy/page'));
