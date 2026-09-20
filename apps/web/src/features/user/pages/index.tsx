import { lazy } from 'react';

export const AsyncUserListPage = lazy(() => import('./UserList/page'));
export const AsyncUserCreatePage = lazy(() => import('./UserCreate/page'));
export const AsyncUserDetailPage = lazy(() => import('./UserDetail/page'));
