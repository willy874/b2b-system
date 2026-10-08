import { registerRouteLink } from '@b2b-system/web-core/route-link';

import { RoleDetailRoute, RoleImportRoute } from './routes/pages';

/** 別的 feature 與命令面板連到角色頁面用的 route id（docs/architecture/frontend/03-feature-anatomy.md §4.1）。 */
export function registerRoleRouteLinks(): void {
  registerRouteLink('role.detail', { route: RoleDetailRoute, params: { roleId: 'roleId' } });
  // 匯入的結果（「我的匯入匯出」的「查看結果」，docs/architecture/backend/22-data-transfer.md §8.4）
  registerRouteLink('role.import', {
    route: RoleImportRoute,
    search: { mode: 'mode', transfer: 'transferId' },
  });
}
