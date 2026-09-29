import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';

import { WORKSPACE_ADMIN_LOCALE_SCOPE } from '../locale';
import { DEFAULT_WORKSPACE_ADMIN_SEARCH, WorkspaceAdminSearchSchema } from './model';

/**
 * 平台管理員的租戶（工作區）管理（`workspace:read`，docs/adr/0019-sso-identity-platform.md D13）；
 * 看得到名稱、成員數與管理員，看不到工作區裡的內容（docs/adr/0018-workspace-tenancy.md D5）。
 */
export const WorkspaceAdminListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/workspaces',
  loader: localeScopeLoader(WORKSPACE_ADMIN_LOCALE_SCOPE),
  validateSearch: WorkspaceAdminSearchSchema,
  search: { middlewares: [stripSearchParams(DEFAULT_WORKSPACE_ADMIN_SEARCH)] },
});
