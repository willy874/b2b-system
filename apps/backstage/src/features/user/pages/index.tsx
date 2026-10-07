import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncUserListPage = lazyRouteComponent(() => import('./UserList/page'));
export const AsyncUserCreatePage = lazyRouteComponent(() => import('./UserCreate/page'));
export const AsyncUserDetailPage = lazyRouteComponent(() => import('./UserDetail/page'));
export const AsyncUserImportPage = lazyRouteComponent(() => import('./UserImport/page'));
