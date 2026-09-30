import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncSettingListPage = lazyRouteComponent(() => import('./SettingList/page'));
