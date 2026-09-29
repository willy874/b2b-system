import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncJobListPage = lazyRouteComponent(() => import('./JobList/page'));
