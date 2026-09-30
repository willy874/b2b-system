import { queryOptions } from '@tanstack/react-query';

import { fetchSettingListQuery } from './fetcher';

export const SETTING_LIST_QUERY_KEY = 'SETTING_LIST_QUERY_KEY';

/** 所有系統設定（`system:read`）；數量少，不分頁。 */
export const getSettingListQueryOptions = () =>
  queryOptions({
    queryKey: [SETTING_LIST_QUERY_KEY] as const,
    queryFn: ({ signal }) => fetchSettingListQuery({ params: undefined, signal }),
  });
