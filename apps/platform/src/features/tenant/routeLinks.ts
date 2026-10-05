import { registerRouteLink } from '@b2b-system/web-core/route-link';

import { TenantDetailRoute } from './routes/pages';

/** 後端連結用的 route id（平台的站內通知，docs/architecture/backend/15-notification.md §6.2）；已發出的 id 不改名。 */
export function registerTenantRouteLinks(): void {
  registerRouteLink('tenant.detail', { route: TenantDetailRoute, params: { id: 'id' } });
}
