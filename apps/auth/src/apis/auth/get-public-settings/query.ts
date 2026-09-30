import { queryOptions } from '@tanstack/react-query';

import { fetchPublicSettingsQuery } from './fetcher';

export const PUBLIC_SETTINGS_QUERY_KEY = 'PUBLIC_SETTINGS_QUERY_KEY';

export const getPublicSettingsQueryOptions = (tenant: string) =>
  queryOptions({
    queryKey: [PUBLIC_SETTINGS_QUERY_KEY, tenant] as const,
    queryFn: ({ signal }) => fetchPublicSettingsQuery({ params: { tenant }, signal }),
  });
