import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncSystemIndexPage = lazyRouteComponent(() => import('./SystemIndex/page'));
export const AsyncSettingListPage = lazyRouteComponent(() => import('./SettingList/page'));
