import { queryOptions } from '@tanstack/react-query';

import { fetchPlatformJobQueuesQuery } from './fetcher';

export const PLATFORM_JOB_QUEUES_QUERY_KEY = 'PLATFORM_JOB_QUEUES_QUERY_KEY';

/** 每種工作的佇列狀態（`platformJob:read`）；筆數是所有租戶加總。 */
export const getPlatformJobQueuesQueryOptions = () =>
  queryOptions({
    queryKey: [PLATFORM_JOB_QUEUES_QUERY_KEY] as const,
    queryFn: ({ signal }) => fetchPlatformJobQueuesQuery({ params: undefined, signal }),
  });
