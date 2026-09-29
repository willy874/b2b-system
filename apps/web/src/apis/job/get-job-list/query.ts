import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import type { HttpRequestDTO } from '@/core/client';

import type { JobListParams } from '../types';
import { fetchJobListQuery } from './fetcher';

export const JOB_LIST_QUERY_KEY = 'JOB_LIST_QUERY_KEY';

const getJobListQueryKeys = (params: JobListParams) =>
  [JOB_LIST_QUERY_KEY, params.offset, params.limit, params.name, params.state] as const;

export const getJobListQueryOptions = (options: HttpRequestDTO<JobListParams>) =>
  queryOptions({
    queryKey: getJobListQueryKeys(options.params),
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => fetchJobListQuery({ params: options.params, signal }),
  });
