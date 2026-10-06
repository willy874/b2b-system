import { registerRouteLink } from '@b2b-system/web-core/route-link';

import { GroupDetailRoute } from './routes/pages';

/** 別的 feature 連到群組頁面用的 route id（docs/architecture/frontend/03-feature-anatomy.md §4.1）。 */
export function registerGroupRouteLinks(): void {
  registerRouteLink('group.detail', { route: GroupDetailRoute, params: { groupId: 'groupId' } });
}
