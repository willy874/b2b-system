import { queryClient } from '@b2b-system/web-core/cache';
import { localeScopeLoader } from '@b2b-system/web-core/locales';
import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute, redirect, stripSearchParams } from '@tanstack/react-router';
import { z } from 'zod/mini';

import { getRoleDetailQueryOptions } from '@/apis/role/get-role-detail/query';
import { requireFeature } from '@/core/feature';

import { ROLE_LOCALE_SCOPE } from '../locale';
import { DEFAULT_ROLE_SEARCH, RoleSearchQuerySchema } from './model';

export const RoleListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/role',
  staticData: { titleKey: 'menu.role' },
  loader: localeScopeLoader(ROLE_LOCALE_SCOPE),
  validateSearch: RoleSearchQuerySchema,
  // 等於預設值的參數不寫進網址（子路由也套用）
  search: { middlewares: [stripSearchParams(DEFAULT_ROLE_SEARCH)] },
});

/** 對話框即路由：可分享網址、上一頁＝關閉對話框。 */
export const RoleCreateRoute = createRoute({
  getParentRoute: () => RoleListRoute,
  path: 'create',
  validateSearch: RoleSearchQuerySchema, // 保留列表的查詢條件
});

export const RoleDetailRoute = createRoute({
  getParentRoute: () => RoleListRoute,
  path: '$roleId',
});

export const RoleDetailPermissionRoute = createRoute({
  getParentRoute: () => RoleDetailRoute,
  path: 'permission',
  // 業務規則（依賴資料狀態）走 beforeLoad；權限守衛走 Layout 層
  beforeLoad: async ({ params }) => {
    const role = await queryClient.ensureQueryData(getRoleDetailQueryOptions(params.roleId));
    if (role.slug === 'super-admin') {
      throw redirect({
        to: '/role/$roleId',
        params: { roleId: params.roleId },
        search: DEFAULT_ROLE_SEARCH,
        replace: true,
      });
    }
  },
});

/**
 * 版本紀錄（docs/architecture/backend/14-revisions.md §9 R5）：與權限子頁一樣是詳情的子路由（對話框即路由）。
 * 不另外註冊頁面權限：路徑在 `/role` 之下，由 `ROLE_PAGE`（`role:read`）涵蓋，與後端的 `GET /roles/:id/revisions` 相同；
 * 還原的操作另外以 `role:update` 顯示。
 */
export const RoleDetailRevisionRoute = createRoute({
  getParentRoute: () => RoleDetailRoute,
  path: 'revision',
});

/** 匯入頁的網址：模式與已送出的傳輸（重新整理或從通知回來時直接顯示結果，docs/architecture/backend/22-data-transfer.md §7.2）。 */
export const RoleImportSearchSchema = z.object({
  mode: z.catch(z.enum(['create', 'update']), 'create'),
  transfer: z.catch(z.optional(z.uuid()), undefined),
});

/**
 * 角色匯入（docs/architecture/backend/22-data-transfer.md §12.1）：全頁，掛在根下而不是 `/role` 底下（不在列表頁的 Outlet 裡，
 * 也有自己的頁面權限）。屬於可啟用的 `dataTransfer`，未啟用時 404。
 */
export const RoleImportRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/role/import',
  staticData: { titleKey: 'menu.roleImport' },
  beforeLoad: requireFeature('dataTransfer'),
  loader: localeScopeLoader(ROLE_LOCALE_SCOPE),
  validateSearch: RoleImportSearchSchema,
  search: { middlewares: [stripSearchParams({ mode: 'create' as const })] },
});
