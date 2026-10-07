import { queryOptions } from '@tanstack/react-query';

import { fetchMfaPolicyQuery } from './fetcher';

export const MFA_POLICY_QUERY_KEY = 'MFA_POLICY_QUERY_KEY';

export const getMfaPolicyQueryOptions = () =>
  queryOptions({
    queryKey: [MFA_POLICY_QUERY_KEY] as const,
    queryFn: ({ signal }) => fetchMfaPolicyQuery({ params: undefined, signal }),
  });
