import { localeScopeLoader } from '@b2b-system/web-core/locales';
import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { requireFeature } from '@/core/feature';

import { SERVICE_ACCOUNT_LOCALE_SCOPE } from '../locale';
import { DEFAULT_SERVICE_ACCOUNT_SEARCH, ServiceAccountSearchQuerySchema } from './model';

/**
 * 這個 feature 在租戶啟用清單裡的 id：服務帳號只能經由對外 API 動作，與它共用一個開關
 * （後端 `TENANT_FEATURES`，docs/architecture/06-external-api.md §3.1）。
 */
export const SERVICE_ACCOUNT_FEATURE = 'externalApi';

export const ServiceAccountListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/service-account',
  staticData: { titleKey: 'menu.serviceAccount' },
  beforeLoad: requireFeature(SERVICE_ACCOUNT_FEATURE),
  loader: localeScopeLoader(SERVICE_ACCOUNT_LOCALE_SCOPE),
  validateSearch: ServiceAccountSearchQuerySchema,
  // 等於預設值的參數不寫進網址（子路由也套用）
  search: { middlewares: [stripSearchParams(DEFAULT_SERVICE_ACCOUNT_SEARCH)] },
});

/** 對話框即路由：可分享網址、上一頁＝關閉對話框。 */
export const ServiceAccountCreateRoute = createRoute({
  getParentRoute: () => ServiceAccountListRoute,
  path: 'create',
  validateSearch: ServiceAccountSearchQuerySchema, // 保留列表的查詢條件
});

export const ServiceAccountDetailRoute = createRoute({
  getParentRoute: () => ServiceAccountListRoute,
  path: '$serviceAccountId',
});
