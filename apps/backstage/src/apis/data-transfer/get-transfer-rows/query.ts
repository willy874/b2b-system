import { queryOptions } from '@tanstack/react-query';

import type { TransferRowsParams } from './fetcher';
import { fetchTransferRowsQuery } from './fetcher';

export const DATA_TRANSFER_ROWS_QUERY_KEY = 'DATA_TRANSFER_ROWS_QUERY_KEY';

export const getTransferRowsQueryKeys = (transferId: string, outcome?: string[]) =>
  [DATA_TRANSFER_ROWS_QUERY_KEY, transferId, outcome?.join(',')] as const;

export const getTransferRowsQueryOptions = (params: TransferRowsParams) =>
  queryOptions({
    queryKey: getTransferRowsQueryKeys(params.transferId, params.outcome),
    queryFn: ({ signal }) => fetchTransferRowsQuery({ params, signal }),
  });
