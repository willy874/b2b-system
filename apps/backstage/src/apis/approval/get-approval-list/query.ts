import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import type { HttpRequestDTO } from '@/core/client';
import { toSortParams } from '@/shared/constants';

import type { ApprovalListParams } from '../types';
import { fetchApprovalListQuery } from './fetcher';

export const APPROVAL_LIST_QUERY_KEY = 'APPROVAL_LIST_QUERY_KEY';

const getApprovalListQueryKeys = (params: ApprovalListParams) =>
  [
    APPROVAL_LIST_QUERY_KEY,
    params.offset,
    params.limit,
    params.keyword,
    params.status?.join(',') ?? '',
    params.type?.join(',') ?? '',
    params.sort ? toSortParams(params.sort).join(',') : '',
  ] as const;

export const getApprovalListQueryOptions = (options: HttpRequestDTO<ApprovalListParams>) =>
  queryOptions({
    queryKey: getApprovalListQueryKeys(options.params),
    placeholderData: keepPreviousData, // 換頁時不閃空白
    queryFn: ({ signal }) => fetchApprovalListQuery({ params: options.params, signal }),
  });
