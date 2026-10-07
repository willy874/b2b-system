import { queryOptions } from '@tanstack/react-query';

import { fetchAdminMfaQuery } from './fetcher';

export const ADMIN_MFA_QUERY_KEY = 'ADMIN_MFA_QUERY_KEY';

export const getAdminMfaQueryOptions = (id: string) =>
  queryOptions({
    queryKey: [ADMIN_MFA_QUERY_KEY, { id }] as const,
    queryFn: ({ signal }) => fetchAdminMfaQuery({ params: { id }, signal }),
  });
