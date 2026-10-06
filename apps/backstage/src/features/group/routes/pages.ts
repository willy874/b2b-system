import { localeScopeLoader } from '@b2b-system/web-core/locales';
import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { GROUP_LOCALE_SCOPE } from '../locale';
import { DEFAULT_GROUP_SEARCH, GroupSearchQuerySchema } from './model';

export const GroupListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/group',
  staticData: { titleKey: 'menu.userGroup' },
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
