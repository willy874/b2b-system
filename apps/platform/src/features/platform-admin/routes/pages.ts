import { localeScopeLoader } from '@b2b-system/web-core/locales';
import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { PLATFORM_ADMIN_LOCALE_SCOPE } from '../locale';
import { DEFAULT_PLATFORM_ADMIN_SEARCH, PlatformAdminSearchQuerySchema } from './model';

/**
 * 平台管理者的帳號管理（`platformAdmin:read`，docs/architecture/05-tenancy.md §10.2 D5）。
 * feature 的入口 route 必須直掛 RootRoute 且用絕對路徑（routeBasePath 依賴這一點）。
 */
export const PlatformAdminListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/admin',
  loader: localeScopeLoader(PLATFORM_ADMIN_LOCALE_SCOPE),
  validateSearch: PlatformAdminSearchQuerySchema,
  search: { middlewares: [stripSearchParams(DEFAULT_PLATFORM_ADMIN_SEARCH)] },
});
