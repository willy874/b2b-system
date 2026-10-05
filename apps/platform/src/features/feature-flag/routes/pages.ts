import { localeScopeLoader } from '@b2b-system/web-core/locales';
import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { FEATURE_FLAG_LOCALE_SCOPE } from '../locale';
import { DEFAULT_FEATURE_FLAG_SEARCH, FeatureFlagSearchQuerySchema } from './model';

/**
 * feature flag 的全平台管理（`featureFlag:read`，docs/architecture/05-tenancy.md §11.2 D8）。
 * feature 的入口 route 必須直掛 RootRoute 且用絕對路徑（routeBasePath 依賴這一點）。
 */
export const FeatureFlagListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/feature-flag',
  loader: localeScopeLoader(FEATURE_FLAG_LOCALE_SCOPE),
  validateSearch: FeatureFlagSearchQuerySchema,
  search: { middlewares: [stripSearchParams(DEFAULT_FEATURE_FLAG_SEARCH)] },
});
