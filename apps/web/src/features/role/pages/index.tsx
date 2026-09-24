import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncRoleListPage = lazyRouteComponent(() => import('./RoleList/page'));
export const AsyncRoleCreatePage = lazyRouteComponent(() => import('./RoleCreate/page'));
export const AsyncRoleDetailPage = lazyRouteComponent(() => import('./RoleDetail/page'));
export const AsyncRoleDetailPermissionPage = lazyRouteComponent(
  () => import('./RoleDetailPermission/page'),
);
