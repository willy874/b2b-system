import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncLoginPage = lazyRouteComponent(() => import('./Login/page'));
