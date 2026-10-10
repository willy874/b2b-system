import { useRouteSearch } from '@b2b-system/web-core/router';

import { FeatureFlagListRoute } from '../../routes';

/** 列表的關鍵字放在網址（不分頁）。 */
export function useFeatureFlagSearchFilter() {
  const { search, patch } = useRouteSearch(FeatureFlagListRoute);
  return {
    search,
    setKeyword: (keyword: string | undefined) => patch({ keyword: keyword || undefined }),
  };
}
