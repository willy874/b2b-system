import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncProfilePage = lazyRouteComponent(() => import('./Profile/page'));
export const AsyncPreferencePage = lazyRouteComponent(() => import('./Preference/page'));
