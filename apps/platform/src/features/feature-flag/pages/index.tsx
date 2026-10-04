import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncFeatureFlagListPage = lazyRouteComponent(() => import('./FeatureFlagList/page'));
