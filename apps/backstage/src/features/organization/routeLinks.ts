import { registerRouteLink } from '@b2b-system/web-core/route-link';

import { OrganizationRoute } from './routes/pages';

/**
 * 別的 feature 連到某個部門用的 route id（docs/architecture/frontend/03-feature-anatomy.md §4.1）：
 * 部門不是子路由，而是組織頁的 `?unitId=`。
 */
export function registerOrganizationRouteLinks(): void {
  registerRouteLink('organization.unit', {
    route: OrganizationRoute,
    search: { unitId: 'unitId' },
  });
}
