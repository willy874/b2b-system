import { queryOptions } from '@tanstack/react-query';

import { fetchCdnOverviewQuery } from './fetcher';

export const CDN_OVERVIEW_QUERY_KEY = 'CDN_OVERVIEW_QUERY_KEY';

/** CDN 頁面（`cdn:read`）。 */
export const getCdnOverviewQueryOptions = () =>
  queryOptions({
    queryKey: [CDN_OVERVIEW_QUERY_KEY] as const,
    queryFn: ({ signal }) => fetchCdnOverviewQuery({ params: undefined, signal }),
  });
