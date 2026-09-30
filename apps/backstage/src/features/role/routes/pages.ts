import { createRoute, redirect, stripSearchParams } from '@tanstack/react-router';

import { getRoleDetailQueryOptions } from '@/apis/role/get-role-detail/query';
import { queryClient } from '@/core/cache';
import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';
import { EventEmitter } from '@/shared/EventEmitter';

import { ROLE_LOCALE_SCOPE } from '../locale';
import { DEFAULT_ROLE_SEARCH, RoleSearchQuerySchema } from './model';

export const RoleListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/role',
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
  context: () => ({
    eventBus: new EventEmitter<{
      'role:updated': () => void;
      'role:permissionsChanged': () => void;
    }>(),
  }),
});

export const RoleDetailPermissionRoute = createRoute({
  getParentRoute: () => RoleDetailRoute,
  path: 'permission',
  // 業務規則（依賴資料狀態）走 beforeLoad；權限守衛走 Layout 層
  beforeLoad: async ({ params }) => {
    const role = await queryClient.ensureQueryData(
      getRoleDetailQueryOptions((params as { roleId: string }).roleId),
    );
    if (role.slug === 'super-admin') {
      throw redirect({
        to: '/role/$roleId',
        params: { roleId: (params as { roleId: string }).roleId },
        search: DEFAULT_ROLE_SEARCH,
        replace: true,
      });
    }
  },
});

/**
 * 版本紀錄（ADR-0025 R5）：與權限子頁一樣是詳情的子路由（對話框即路由）。
 * 不另外註冊頁面權限：路徑在 `/role` 之下，由 `ROLE_PAGE`（`role:read`）涵蓋，與後端的 `GET /roles/:id/revisions` 相同；
 * 還原的操作另外以 `role:update` 顯示。
 */
export const RoleDetailRevisionRoute = createRoute({
  getParentRoute: () => RoleDetailRoute,
  path: 'revision',
});
