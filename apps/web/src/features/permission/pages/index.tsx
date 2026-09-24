import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncPermissionListPage = lazyRouteComponent(() => import('./PermissionList/page'));
