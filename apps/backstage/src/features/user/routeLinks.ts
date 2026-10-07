import { registerRouteLink } from '@b2b-system/web-core/route-link';

import { UserDetailRoute, UserListRoute } from './routes/pages';

/** 別的 feature 連到使用者頁面用的 route id（docs/architecture/frontend/03-feature-anatomy.md §4.1）。 */
export function registerUserRouteLinks(): void {
  registerRouteLink('user.detail', { route: UserDetailRoute, params: { userId: 'userId' } });
  // 依 MFA 篩選的列表（安全性頁的「不符合政策的人」，docs/architecture/backend/21-mfa.md §6）
  registerRouteLink('user.listByMfa', { route: UserListRoute, search: { mfa: 'mfa' } });
}
