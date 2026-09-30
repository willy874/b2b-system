import { createRoute } from '@tanstack/react-router';

import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';

import { FEATURE_FLAG_LOCALE_SCOPE } from '../locale';

/**
 * feature flag 的全平台管理（`featureFlag:read`，docs/adr/0022-feature-flags.md D8）。
 * feature 的入口 route 必須直掛 RootRoute 且用絕對路徑（routeBasePath 依賴這一點）。
 */
export const FeatureFlagListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/feature-flag',
  loader: localeScopeLoader(FEATURE_FLAG_LOCALE_SCOPE),
});
