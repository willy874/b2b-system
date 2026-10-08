import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncOrganizationPage = lazyRouteComponent(() => import('./Organization/page'));
