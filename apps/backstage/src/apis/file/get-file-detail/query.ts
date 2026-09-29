import { queryOptions } from '@tanstack/react-query';

import { fetchFileDetailQuery } from './fetcher';

export const FILE_DETAIL_QUERY_KEY = 'FILE_DETAIL_QUERY_KEY';

/** key 的第二段是檔案 id（依賴圖以 id 失效），工作區放在最後。 */
export const getFileDetailQueryOptions = (workspaceId: string, fileId: string) =>
  queryOptions({
    queryKey: [FILE_DETAIL_QUERY_KEY, fileId, workspaceId] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchFileDetailQuery({ params: { fileId: queryKey[1], workspaceId: queryKey[2] }, signal }),
  });
