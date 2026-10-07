import type { HttpRequestDTO } from '@b2b-system/web-core/client';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import type { DataTransferListParams } from '../types';
import { fetchTransferListQuery } from './fetcher';

export const DATA_TRANSFER_LIST_QUERY_KEY = 'DATA_TRANSFER_LIST_QUERY_KEY';

const getTransferListQueryKeys = (params: DataTransferListParams) =>
  [
    DATA_TRANSFER_LIST_QUERY_KEY,
    params.offset,
    params.limit,
    params.direction,
    params.type,
    params.status?.join(','),
  ] as const;

export const getTransferListQueryOptions = (options: HttpRequestDTO<DataTransferListParams>) =>
  queryOptions({
    queryKey: getTransferListQueryKeys(options.params),
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => fetchTransferListQuery({ params: options.params, signal }),
  });
