import { queryOptions } from '@tanstack/react-query';

import { fetchFileAccessRequestListQuery } from './fetcher';

export const FILE_ACCESS_REQUEST_LIST_QUERY_KEY = 'FILE_ACCESS_REQUEST_LIST_QUERY_KEY';

/** 資料夾的待審存取申請（需要能管理它的授權，docs/rbac/07-resource-grants.md §6.5）。 */
/** key 的第二段是資料夾（id 全域唯一，依賴圖以 id 失效），工作區放在最後。 */
export const getFileAccessRequestListQueryOptions = (workspaceId: string, folderId: string) =>
  queryOptions({
    queryKey: [FILE_ACCESS_REQUEST_LIST_QUERY_KEY, folderId, workspaceId] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchFileAccessRequestListQuery({
        params: { folderId: queryKey[1], workspaceId: queryKey[2] },
        signal,
      }),
  });
