import { localeScopeLoader } from '@b2b-system/web-core/locales';
import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { TENANT_LOCALE_SCOPE } from '../locale';
import {
  DEFAULT_TENANT_DETAIL_SEARCH,
  DEFAULT_TENANT_SEARCH,
  TenantDetailSearchSchema,
  TenantSearchQuerySchema,
} from './model';

/**
 * 平台管理者的租戶管理（`tenant:read`，docs/architecture/05-tenancy.md §10.2 D12、D13）。
 * feature 的入口 route 必須直掛 RootRoute 且用絕對路徑（routeBasePath 依賴這一點）。
 */
export const TenantListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/tenant',
  staticData: { titleKey: 'menu.tenant' },
  loader: localeScopeLoader(TENANT_LOCALE_SCOPE),
  // 分頁、搜尋與狀態篩選放在網址上：重新整理或分享連結都保留；等於預設值的參數不寫進網址
  validateSearch: TenantSearchQuerySchema,
  search: { middlewares: [stripSearchParams(DEFAULT_TENANT_SEARCH)] },
});

/** 一個租戶：狀態、網域、佈建失敗的原因與停用／刪除。權限沿用列表頁（`/tenant` 前綴）。 */
export const TenantDetailRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/tenant/$id',
  staticData: { titleKey: 'menu.tenant' },
  loader: localeScopeLoader(TENANT_LOCALE_SCOPE),
  // 目前的分頁放在網址上：重新整理或分享連結都停在同一頁；概覽（預設）不寫進網址
  validateSearch: TenantDetailSearchSchema,
  search: { middlewares: [stripSearchParams(DEFAULT_TENANT_DETAIL_SEARCH)] },
});
