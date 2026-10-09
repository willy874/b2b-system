import { queryOptions } from '@tanstack/react-query';

import { fetchMfaMethodSettingsQuery } from './fetcher';

export const MFA_METHOD_SETTINGS_QUERY_KEY = 'MFA_METHOD_SETTINGS_QUERY_KEY';

export const getMfaMethodSettingsQueryOptions = (id: string) =>
  queryOptions({
    queryKey: [MFA_METHOD_SETTINGS_QUERY_KEY, id] as const,
    queryFn: ({ signal }) => fetchMfaMethodSettingsQuery({ params: { id }, signal }),
  });
