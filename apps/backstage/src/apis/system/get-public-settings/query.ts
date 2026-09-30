import { queryOptions } from '@tanstack/react-query';

import { fetchPublicSettingsQuery } from './fetcher';

export const PUBLIC_SETTINGS_QUERY_KEY = 'PUBLIC_SETTINGS_QUERY_KEY';

/** 公開設定（未登入也讀得到）：key → 生效值。 */
export const getPublicSettingsQueryOptions = () =>
  queryOptions({
    queryKey: [PUBLIC_SETTINGS_QUERY_KEY] as const,
    queryFn: ({ signal }) => fetchPublicSettingsQuery({ params: undefined, signal }),
  });
