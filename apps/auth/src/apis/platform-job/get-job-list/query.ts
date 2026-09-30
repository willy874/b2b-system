import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import type { HttpRequestDTO } from '@/core/client';

import type { PlatformJobListParams } from '../types';
import { fetchPlatformJobListQuery } from './fetcher';

export const PLATFORM_JOB_LIST_QUERY_KEY = 'PLATFORM_JOB_LIST_QUERY_KEY';

const getPlatformJobListQueryKeys = (params: PlatformJobListParams) =>
  [
    PLATFORM_JOB_LIST_QUERY_KEY,
    params.offset,
    params.limit,
    params.name,
    params.state,
    params.tenant,
  ] as const;

/** 所有租戶與平台層級的工作（`platformJob:read`），分頁。 */
export const getPlatformJobListQueryOptions = (options: HttpRequestDTO<PlatformJobListParams>) =>
  queryOptions({
    queryKey: getPlatformJobListQueryKeys(options.params),
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => fetchPlatformJobListQuery({ params: options.params, signal }),
  });
