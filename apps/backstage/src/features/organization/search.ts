import { registerSearchProvider, SEARCH_RESULT_LIMIT } from '@b2b-system/web-core/command-palette';

import { fetchOrgUnitTreeQuery } from '@/apis/org-unit/get-org-unit-tree/fetcher';

import { ORG_UNIT_PAGE } from './permission';

/**
 * 命令面板：搜尋部門名稱與代碼，選取後開到 `/organization?unitId=`（docs/architecture/frontend/18-command-palette.md §4）。
 * 建立部門是組織頁裡的對話框、不是路由，所以不登記「建立部門」指令。
 */
export function registerOrganizationSearch(): void {
  registerSearchProvider({
    key: 'orgUnit',
    labelI18nKey: 'menu.organization',
    icon: 'grid',
    pageKey: ORG_UNIT_PAGE,
    order: 350,
    search: async (keyword, signal) => {
      // 後端回符合的部門 ＋ 它們的上層（樹才接得起來）；搜尋結果只要符合的那些
      // （不用 `core/components/OrgUnitPicker` 的比對：這個檔案在首屏，那裡會帶進 Select）
      const { items } = await fetchOrgUnitTreeQuery({ params: { keyword }, signal });
      const needle = keyword.trim().toLocaleLowerCase();
      return items
        .filter(
          (unit) =>
            unit.name.toLocaleLowerCase().includes(needle) ||
            (unit.code?.toLocaleLowerCase().includes(needle) ?? false),
        )
        .slice(0, SEARCH_RESULT_LIMIT)
        .map((unit) => ({
          id: unit.id,
          label: unit.name,
          description: unit.code ?? undefined,
          link: { route: 'organization.unit', params: { unitId: unit.id } },
        }));
    },
  });
}
