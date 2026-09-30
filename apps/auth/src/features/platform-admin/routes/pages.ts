import { createRoute } from '@tanstack/react-router';

import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';

import { PLATFORM_ADMIN_LOCALE_SCOPE } from '../locale';

/**
 * 平台管理者的帳號管理（`platformAdmin:read`，docs/adr/0020-physical-tenant-isolation.md D5）。
 * feature 的入口 route 必須直掛 RootRoute 且用絕對路徑（routeBasePath 依賴這一點）。
 */
export const PlatformAdminListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/admin',
  loader: localeScopeLoader(PLATFORM_ADMIN_LOCALE_SCOPE),
});
