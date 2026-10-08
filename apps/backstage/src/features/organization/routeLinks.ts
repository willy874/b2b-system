import { registerRouteLink } from '@b2b-system/web-core/route-link';

import { OrganizationRoute, OrgUnitImportRoute, OrgUnitMemberImportRoute } from './routes/pages';

/**
 * 別的 feature 連到某個部門用的 route id（docs/architecture/frontend/03-feature-anatomy.md §4.1）：
 * 部門不是子路由，而是組織頁的 `?unitId=`。
 */
export function registerOrganizationRouteLinks(): void {
  registerRouteLink('organization.unit', {
    route: OrganizationRoute,
    search: { unitId: 'unitId' },
  });
  // 匯入的結果（「我的匯入匯出」的「查看結果」，docs/architecture/backend/22-data-transfer.md §8.4）
  registerRouteLink('orgUnit.import', {
    route: OrgUnitImportRoute,
    search: { mode: 'mode', transfer: 'transferId' },
  });
  registerRouteLink('orgUnitMember.import', {
    route: OrgUnitMemberImportRoute,
    search: { mode: 'mode', transfer: 'transferId' },
  });
}
