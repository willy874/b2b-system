import { registerRouteLink } from '@b2b-system/web-core/route-link';

import { UserDetailRoute, UserImportRoute, UserListRoute } from './routes/pages';

/** 別的 feature 連到使用者頁面用的 route id（docs/architecture/frontend/03-feature-anatomy.md §4.1）。 */
export function registerUserRouteLinks(): void {
  registerRouteLink('user.detail', { route: UserDetailRoute, params: { userId: 'userId' } });
  // 依 MFA 篩選的列表（安全性頁的「不符合政策的人」，docs/architecture/backend/21-mfa.md §6）：
  // 全員必須時是可登入、還沒設定的人；只要求特定角色時再加上持有這些角色（含經由群組）的人，與頁面上的人數同一個判斷
  registerRouteLink('user.listByMfa', {
    route: UserListRoute,
    search: { mfa: 'mfa', status: 'status' },
  });
  registerRouteLink('user.listByMfaRole', {
    route: UserListRoute,
    search: {
      mfa: 'mfa',
      status: 'status',
      roleId: 'roleIds',
      includeGroupRoles: 'includeGroupRoles',
    },
  });
  // 匯入的結果（「我的匯入匯出」的「查看結果」，docs/architecture/backend/22-data-transfer.md §8.4）
  registerRouteLink('user.import', {
    route: UserImportRoute,
    search: { mode: 'mode', transfer: 'transferId' },
  });
}
