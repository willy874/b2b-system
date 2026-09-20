import { createRoute, redirect } from '@tanstack/react-router';

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
