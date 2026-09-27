import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncFileManagerPage = lazyRouteComponent(() => import('./FileManager/page'));
