import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncHomePage = lazyRouteComponent(() => import('./Home/page'));
