import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncCdnOverviewPage = lazyRouteComponent(() => import('./CdnOverview/page'));
