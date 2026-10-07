import { queryOptions } from '@tanstack/react-query';

import { fetchMfaOverviewQuery } from './fetcher';

export const MFA_OVERVIEW_QUERY_KEY = 'MFA_OVERVIEW_QUERY_KEY';

export const getMfaOverviewQueryOptions = () =>
  queryOptions({
    queryKey: [MFA_OVERVIEW_QUERY_KEY] as const,
    queryFn: ({ signal }) => fetchMfaOverviewQuery({ params: undefined, signal }),
  });
