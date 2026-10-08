import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncTagListPage = lazyRouteComponent(() => import('./TagList/page'));
export const AsyncTagImportPage = lazyRouteComponent(() => import('./TagImport/page'));
