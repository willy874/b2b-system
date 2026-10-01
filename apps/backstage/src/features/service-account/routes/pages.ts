import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';

import { SERVICE_ACCOUNT_LOCALE_SCOPE } from '../locale';
import { DEFAULT_SERVICE_ACCOUNT_SEARCH, ServiceAccountSearchQuerySchema } from './model';

export const ServiceAccountListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/service-account',
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
