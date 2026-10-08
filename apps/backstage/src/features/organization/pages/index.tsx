import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncOrganizationPage = lazyRouteComponent(() => import('./Organization/page'));
export const AsyncOrgUnitImportPage = lazyRouteComponent(() => import('./OrgUnitImport/page'));
export const AsyncOrgUnitMemberImportPage = lazyRouteComponent(
  () => import('./OrgUnitMemberImport/page'),
);
