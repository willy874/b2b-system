import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';

import { WORKSPACE_LOCALE_SCOPE } from '../locale';
import { DEFAULT_WORKSPACE_MEMBER_SEARCH, WorkspaceMemberSearchSchema } from './model';

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
