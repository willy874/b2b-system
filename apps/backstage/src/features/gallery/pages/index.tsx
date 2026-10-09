import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncGalleryPage = lazyRouteComponent(() => import('./Gallery/page'));
