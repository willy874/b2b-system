import {
  registerPaletteCommand,
  registerSearchProvider,
  SEARCH_RESULT_LIMIT,
} from '@b2b-system/web-core/command-palette';

import { fetchUserListQuery } from '@/apis/user/get-user-list/fetcher';
import { routeBasePath } from '@/core/permission';

import { USER_CREATE_PAGE, USER_PAGE } from './permission';
import { UserCreateRoute } from './routes/pages';

/** 命令面板：搜尋使用者（名稱、email、帳號）與「建立使用者」（docs/architecture/frontend/18-command-palette.md §4）。 */
export function registerUserSearch(): void {
  registerSearchProvider({
    key: 'user',
    labelI18nKey: 'menu.user',
    icon: 'user',
    pageKey: USER_PAGE,
    order: 100,
    search: async (keyword, signal) => {
      const { items } = await fetchUserListQuery({
        params: { offset: 0, limit: SEARCH_RESULT_LIMIT, keyword },
        signal,
      });
      return items.map((user) => ({
        id: user.id,
        label: user.displayName,
        description: user.email,
        link: { route: 'user.detail', params: { userId: user.id } },
      }));
    },
  });
  registerPaletteCommand({
    key: 'user.create',
    labelI18nKey: 'commandPalette.command.createUser',
    icon: 'plus',
    pageKey: USER_CREATE_PAGE,
    order: 100,
    to: routeBasePath(UserCreateRoute),
  });
}
