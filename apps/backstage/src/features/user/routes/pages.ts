import { localeScopeLoader } from '@b2b-system/web-core/locales';
import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute, stripSearchParams } from '@tanstack/react-router';
import { z } from 'zod';

import { requireFeature } from '@/core/feature';

import { USER_LOCALE_SCOPE } from '../locale';
import { DEFAULT_USER_SEARCH, UserSearchQuerySchema } from './model';

export const UserListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/user',
  staticData: { titleKey: 'menu.user' },
  loader: localeScopeLoader(USER_LOCALE_SCOPE),
  validateSearch: UserSearchQuerySchema,
  // 等於預設值的參數不寫進網址（子路由也套用）
  search: { middlewares: [stripSearchParams(DEFAULT_USER_SEARCH)] },
});

export const UserCreateRoute = createRoute({
  getParentRoute: () => UserListRoute,
  path: 'create',
  validateSearch: UserSearchQuerySchema,
});

export const UserDetailRoute = createRoute({
  getParentRoute: () => UserListRoute,
  path: '$userId',
});

/** 匯入頁的網址：模式與已送出的傳輸（重新整理或從通知回來時直接顯示結果，docs/architecture/backend/22-data-transfer.md §7.2）。 */
export const UserImportSearchSchema = z.object({
  mode: z.enum(['create', 'update']).catch('create'),
  transfer: z.string().uuid().optional().catch(undefined),
});

/**
 * 使用者匯入（全頁，不是對話框：表格需要整個畫面）。掛在根下而不是 `/user` 底下：不在列表頁的 Outlet 裡，
 * 也有自己的頁面權限（最長前綴）。屬於可啟用的 `dataTransfer`，未啟用時 404。
 */
export const UserImportRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/user/import',
  staticData: { titleKey: 'menu.userImport' },
  beforeLoad: requireFeature('dataTransfer'),
  loader: localeScopeLoader(USER_LOCALE_SCOPE),
  validateSearch: UserImportSearchSchema,
  search: { middlewares: [stripSearchParams({ mode: 'create' as const })] },
});
