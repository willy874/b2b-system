import {
  registerPaletteCommand,
  registerSearchProvider,
  SEARCH_RESULT_LIMIT,
} from '@b2b-system/web-core/command-palette';

import { fetchRoleListQuery } from '@/apis/role/get-role-list/fetcher';
import { routeBasePath } from '@/core/permission';

import { ROLE_CREATE_PAGE, ROLE_PAGE } from './permission';
import { RoleCreateRoute } from './routes/pages';

/** 命令面板：搜尋角色與「建立角色」（docs/architecture/frontend/18-command-palette.md §4）。 */
export function registerRoleSearch(): void {
  registerSearchProvider({
    key: 'role',
    labelI18nKey: 'menu.role',
    icon: 'shield',
    pageKey: ROLE_PAGE,
    order: 200,
    search: async (keyword, signal) => {
      const { items } = await fetchRoleListQuery({
        params: { offset: 0, limit: SEARCH_RESULT_LIMIT, keyword },
        signal,
      });
      return items.map((role) => ({
        id: role.id,
        label: role.name,
        description: role.slug,
        link: { route: 'role.detail', params: { roleId: role.id } },
      }));
    },
  });
  registerPaletteCommand({
    key: 'role.create',
    labelI18nKey: 'commandPalette.command.createRole',
    icon: 'plus',
    pageKey: ROLE_CREATE_PAGE,
    order: 200,
    to: routeBasePath(RoleCreateRoute),
  });
}
