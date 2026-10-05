import type { HttpRequestDTO } from '@b2b-system/web-core/client';
import { toSortParams } from '@b2b-system/web-shared/constants';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import type { ServiceAccountListParams } from '../types';
import { fetchServiceAccountListQuery } from './fetcher';

export const SERVICE_ACCOUNT_LIST_QUERY_KEY = 'SERVICE_ACCOUNT_LIST_QUERY_KEY';

export const getServiceAccountListQueryOptions = (
  options: HttpRequestDTO<ServiceAccountListParams>,
) =>
  queryOptions({
    queryKey: [
      SERVICE_ACCOUNT_LIST_QUERY_KEY,
      options.params.offset,
      options.params.limit,
      options.params.keyword,
      options.params.sort ? toSortParams(options.params.sort).join(',') : '',
    ] as const,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => fetchServiceAccountListQuery({ params: options.params, signal }),
  });
