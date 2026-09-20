import { lazy } from 'react';

export const AsyncRoleListPage = lazy(() => import('./RoleList/page'));
export const AsyncRoleCreatePage = lazy(() => import('./RoleCreate/page'));
export const AsyncRoleDetailPage = lazy(() => import('./RoleDetail/page'));
export const AsyncRoleDetailPermissionPage = lazy(() => import('./RoleDetailPermission/page'));
