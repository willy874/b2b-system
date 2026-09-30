import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncTenantListPage = lazyRouteComponent(() => import('./TenantList/page'));
export const AsyncTenantDetailPage = lazyRouteComponent(() => import('./TenantDetail/page'));
