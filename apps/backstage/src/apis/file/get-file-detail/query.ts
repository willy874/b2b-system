import { queryOptions } from '@tanstack/react-query';

import { fetchFileDetailQuery } from './fetcher';

export const FILE_DETAIL_QUERY_KEY = 'FILE_DETAIL_QUERY_KEY';

export const getFileDetailQueryOptions = (fileId: string) =>
  queryOptions({
    queryKey: [FILE_DETAIL_QUERY_KEY, fileId] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchFileDetailQuery({ params: { fileId: queryKey[1] }, signal }),
  });
