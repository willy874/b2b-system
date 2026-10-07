import { registerRouteLink } from '@b2b-system/web-core/route-link';

import { RoleDetailRoute } from './routes/pages';

/** 別的 feature 與命令面板連到角色頁面用的 route id（docs/architecture/frontend/03-feature-anatomy.md §4.1）。 */
export function registerRoleRouteLinks(): void {
  registerRouteLink('role.detail', { route: RoleDetailRoute, params: { roleId: 'roleId' } });
}
