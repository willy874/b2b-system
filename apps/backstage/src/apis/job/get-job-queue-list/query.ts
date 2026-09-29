import { queryOptions } from '@tanstack/react-query';

import { fetchJobQueueListQuery } from './fetcher';

export const JOB_QUEUE_LIST_QUERY_KEY = 'JOB_QUEUE_LIST_QUERY_KEY';

export const getJobQueueListQueryOptions = () =>
  queryOptions({
    queryKey: [JOB_QUEUE_LIST_QUERY_KEY] as const,
    queryFn: ({ signal }) => fetchJobQueueListQuery({ params: undefined, signal }),
  });
