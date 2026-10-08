import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncRoleListPage = lazyRouteComponent(() => import('./RoleList/page'));
export const AsyncRoleCreatePage = lazyRouteComponent(() => import('./RoleCreate/page'));
export const AsyncRoleDetailPage = lazyRouteComponent(() => import('./RoleDetail/page'));
export const AsyncRoleDetailPermissionPage = lazyRouteComponent(
  () => import('./RoleDetailPermission/page'),
);
export const AsyncRoleDetailRevisionPage = lazyRouteComponent(
  () => import('./RoleDetailRevision/page'),
);
export const AsyncRoleImportPage = lazyRouteComponent(() => import('./RoleImport/page'));
