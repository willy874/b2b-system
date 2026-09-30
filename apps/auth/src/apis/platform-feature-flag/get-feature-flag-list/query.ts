import { queryOptions } from '@tanstack/react-query';

import { fetchFeatureFlagListQuery } from './fetcher';

export const FEATURE_FLAG_LIST_QUERY_KEY = 'FEATURE_FLAG_LIST_QUERY_KEY';

/**
 * feature flag 的目錄、全平台覆寫與覆寫它的租戶數（`featureFlag:read`，docs/adr/0022-feature-flags.md D8）。
 * 目錄就是全部，不分頁。
 */
export const getFeatureFlagListQueryOptions = () =>
  queryOptions({
    queryKey: [FEATURE_FLAG_LIST_QUERY_KEY] as const,
    queryFn: ({ signal }) => fetchFeatureFlagListQuery({ params: undefined, signal }),
  });
