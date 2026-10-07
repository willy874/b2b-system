import { queryOptions } from '@tanstack/react-query';

import { fetchTransferQuery } from './fetcher';

export const DATA_TRANSFER_DETAIL_QUERY_KEY = 'DATA_TRANSFER_DETAIL_QUERY_KEY';

export const getTransferQueryKeys = (transferId: string) =>
  [DATA_TRANSFER_DETAIL_QUERY_KEY, transferId] as const;

export const getTransferQueryOptions = (transferId: string) =>
  queryOptions({
    queryKey: getTransferQueryKeys(transferId),
    queryFn: ({ signal }) => fetchTransferQuery({ params: { transferId }, signal }),
  });
