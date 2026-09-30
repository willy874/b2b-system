import { queryOptions } from '@tanstack/react-query';

import { fetchIdentityProviderListQuery } from './fetcher';

export const IDENTITY_PROVIDER_LIST_QUERY_KEY = 'IDENTITY_PROVIDER_LIST_QUERY_KEY';

/** 平台的外部 IdP 連線（`identityProvider:read`）；數量少，不分頁。 */
export const getIdentityProviderListQueryOptions = () =>
  queryOptions({
    queryKey: [IDENTITY_PROVIDER_LIST_QUERY_KEY] as const,
    queryFn: ({ signal }) => fetchIdentityProviderListQuery({ params: undefined, signal }),
  });
