import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncTrashListPage = lazyRouteComponent(() => import('./TrashList/page'));
