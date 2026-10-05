import { registerRouteLink } from '@/core/route-link';

import { UserDetailRoute } from './routes/pages';

/** 別的 feature 連到使用者頁面用的 route id（docs/architecture/frontend/03-feature-anatomy.md §4.1）。 */
export function registerUserRouteLinks(): void {
  registerRouteLink('user.detail', { route: UserDetailRoute, params: { userId: 'userId' } });
}
