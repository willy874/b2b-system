import { useRouteSearch } from '@b2b-system/web-core/router';

import { PlatformAdminListRoute } from '../../routes';

/** 列表的關鍵字放在網址（不分頁）。 */
export function usePlatformAdminSearchFilter() {
  const { search, patch } = useRouteSearch(PlatformAdminListRoute);
  return {
    search,
    setKeyword: (keyword: string | undefined) => patch({ keyword: keyword || undefined }),
  };
}
