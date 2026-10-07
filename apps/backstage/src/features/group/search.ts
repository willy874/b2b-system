import {
  registerPaletteCommand,
  registerSearchProvider,
  SEARCH_RESULT_LIMIT,
} from '@b2b-system/web-core/command-palette';

import { fetchGroupListQuery } from '@/apis/group/get-group-list/fetcher';
import { routeBasePath } from '@/core/permission';

import { GROUP_CREATE_PAGE, GROUP_PAGE } from './permission';
import { GroupCreateRoute } from './routes/pages';

/** 命令面板：搜尋群組與「建立群組」（docs/architecture/frontend/18-command-palette.md §4）。 */
export function registerGroupSearch(): void {
  registerSearchProvider({
    key: 'group',
    labelI18nKey: 'menu.userGroup',
    icon: 'users',
    pageKey: GROUP_PAGE,
    order: 300,
    search: async (keyword, signal) => {
      const { items } = await fetchGroupListQuery({
        params: { offset: 0, limit: SEARCH_RESULT_LIMIT, keyword },
        signal,
      });
      return items.map((group) => ({
        id: group.id,
        label: group.name,
        description: group.description ?? undefined,
        link: { route: 'group.detail', params: { groupId: group.id } },
      }));
    },
  });
  registerPaletteCommand({
    key: 'group.create',
    labelI18nKey: 'commandPalette.command.createGroup',
    icon: 'plus',
    pageKey: GROUP_CREATE_PAGE,
    order: 300,
    to: routeBasePath(GroupCreateRoute),
  });
}
