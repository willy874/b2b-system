import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';

import { WORKSPACE_LOCALE_SCOPE } from '../locale';
import {
  DEFAULT_WORKSPACE_ADMIN_SEARCH,
  DEFAULT_WORKSPACE_MEMBER_SEARCH,
  WorkspaceAdminSearchSchema,
  WorkspaceMemberSearchSchema,
} from './model';

/**
 * 工作區的版面：`/w/:workspaceSlug/…`（docs/adr/0018-workspace-tenancy.md D17）。
 * 解析 slug、載入在這個工作區的權限之後才渲染子頁面；其他 feature 的工作區頁面掛在它底下
 * （經各自的 `routes/external.ts`）。
 */
export const WorkspaceRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/w/$workspaceSlug',
  loader: localeScopeLoader(WORKSPACE_LOCALE_SCOPE),
});

export const WorkspaceMembersRoute = createRoute({
  getParentRoute: () => WorkspaceRoute,
  path: 'members',
  validateSearch: WorkspaceMemberSearchSchema,
  search: { middlewares: [stripSearchParams(DEFAULT_WORKSPACE_MEMBER_SEARCH)] },
});

/**
 * 平台的工作區管理搬到 apps/auth（docs/adr/0019-sso-identity-platform.md D13）：這個網址保留一版轉過去。
 * 頁面權限仍以它註冊，側邊選單依 `workspace:read` 決定要不要顯示連到 apps/auth 的項目。
 */
export const WorkspaceAdminListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/workspace',
  loader: localeScopeLoader(WORKSPACE_LOCALE_SCOPE),
  validateSearch: WorkspaceAdminSearchSchema,
  search: { middlewares: [stripSearchParams(DEFAULT_WORKSPACE_ADMIN_SEARCH)] },
});
