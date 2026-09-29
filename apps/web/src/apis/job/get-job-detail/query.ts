import { queryOptions } from '@tanstack/react-query';

import { fetchJobDetailQuery } from './fetcher';

export const JOB_DETAIL_QUERY_KEY = 'JOB_DETAIL_QUERY_KEY';

export const getJobDetailQueryOptions = (id: string) =>
  queryOptions({
    queryKey: [JOB_DETAIL_QUERY_KEY, id] as const,
    queryFn: ({ queryKey, signal }) => fetchJobDetailQuery({ params: { id: queryKey[1] }, signal }),
  });
