import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncGroupListPage = lazyRouteComponent(() => import('./GroupList/page'));
export const AsyncGroupCreatePage = lazyRouteComponent(() => import('./GroupCreate/page'));
export const AsyncGroupDetailPage = lazyRouteComponent(() => import('./GroupDetail/page'));
export const AsyncGroupImportPage = lazyRouteComponent(() => import('./GroupImport/page'));
export const AsyncGroupMemberImportPage = lazyRouteComponent(
  () => import('./GroupMemberImport/page'),
);
