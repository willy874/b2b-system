import { queryOptions } from '@tanstack/react-query';

import { fetchTransferResourcesQuery } from './fetcher';

export const DATA_TRANSFER_RESOURCES_QUERY_KEY = 'DATA_TRANSFER_RESOURCES_QUERY_KEY';

export const getTransferResourcesQueryKeys = () => [DATA_TRANSFER_RESOURCES_QUERY_KEY] as const;

export const getTransferResourcesQueryOptions = () =>
  queryOptions({
    queryKey: getTransferResourcesQueryKeys(),
    queryFn: ({ signal }) => fetchTransferResourcesQuery({ params: undefined, signal }),
    staleTime: 60_000,
  });
