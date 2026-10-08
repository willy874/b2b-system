import { registerRouteLink } from '@b2b-system/web-core/route-link';

import { GroupDetailRoute, GroupImportRoute, GroupMemberImportRoute } from './routes/pages';

/** 別的 feature 連到群組頁面用的 route id（docs/architecture/frontend/03-feature-anatomy.md §4.1）。 */
export function registerGroupRouteLinks(): void {
  registerRouteLink('group.detail', { route: GroupDetailRoute, params: { groupId: 'groupId' } });
  // 匯入的結果（「我的匯入匯出」的「查看結果」，docs/architecture/backend/22-data-transfer.md §8.4）
  registerRouteLink('group.import', {
    route: GroupImportRoute,
    search: { mode: 'mode', transfer: 'transferId' },
  });
  registerRouteLink('groupMember.import', {
    route: GroupMemberImportRoute,
    search: { mode: 'mode', transfer: 'transferId' },
  });
}
