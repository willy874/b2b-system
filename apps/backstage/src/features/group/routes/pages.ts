import { localeScopeLoader } from '@b2b-system/web-core/locales';
import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { requireFeature } from '@/core/feature';

import { GROUP_LOCALE_SCOPE } from '../locale';
import { DEFAULT_GROUP_SEARCH, GroupSearchQuerySchema } from './model';

/** 這個 feature 在租戶啟用清單裡的 id（後端 `TENANT_FEATURES`，docs/architecture/iam/07-groups.md §8）。 */
export const GROUP_FEATURE = 'group';

export const GroupListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/group',
  staticData: { titleKey: 'menu.userGroup' },
  beforeLoad: requireFeature(GROUP_FEATURE),
  loader: localeScopeLoader(GROUP_LOCALE_SCOPE),
  validateSearch: GroupSearchQuerySchema,
  // 等於預設值的參數不寫進網址（子路由也套用）
  search: { middlewares: [stripSearchParams(DEFAULT_GROUP_SEARCH)] },
});

/** 對話框即路由：可分享網址、上一頁＝關閉對話框。 */
export const GroupCreateRoute = createRoute({
  getParentRoute: () => GroupListRoute,
  path: 'create',
  validateSearch: GroupSearchQuerySchema, // 保留列表的查詢條件
});

export const GroupDetailRoute = createRoute({
  getParentRoute: () => GroupListRoute,
  path: '$groupId',
});
