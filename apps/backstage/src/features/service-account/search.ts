import {
  registerPaletteCommand,
  registerSearchProvider,
  SEARCH_RESULT_LIMIT,
} from '@b2b-system/web-core/command-palette';

import { fetchServiceAccountListQuery } from '@/apis/service-account/get-service-account-list/fetcher';
import { routeBasePath } from '@/core/permission';

import { SERVICE_ACCOUNT_CREATE_PAGE, SERVICE_ACCOUNT_PAGE } from './permission';
import { ServiceAccountCreateRoute } from './routes/pages';

/** 命令面板：搜尋服務帳號與「建立服務帳號」（docs/architecture/frontend/18-command-palette.md §4）。 */
export function registerServiceAccountSearch(): void {
  registerSearchProvider({
    key: 'serviceAccount',
    labelI18nKey: 'menu.serviceAccount',
    icon: 'monitor',
    pageKey: SERVICE_ACCOUNT_PAGE,
    order: 400,
    search: async (keyword, signal) => {
      const { items } = await fetchServiceAccountListQuery({
        params: { offset: 0, limit: SEARCH_RESULT_LIMIT, keyword },
        signal,
      });
      return items.map((account) => ({
        id: account.id,
        label: account.name,
        link: { route: 'serviceAccount.detail', params: { serviceAccountId: account.id } },
      }));
    },
  });
  registerPaletteCommand({
    key: 'serviceAccount.create',
    labelI18nKey: 'commandPalette.command.createServiceAccount',
    icon: 'plus',
    pageKey: SERVICE_ACCOUNT_CREATE_PAGE,
    order: 400,
    to: routeBasePath(ServiceAccountCreateRoute),
  });
}
