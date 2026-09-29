import { queryOptions } from '@tanstack/react-query';

import { fetchFileFolderGrantListQuery } from './fetcher';

export const FILE_FOLDER_GRANT_LIST_QUERY_KEY = 'FILE_FOLDER_GRANT_LIST_QUERY_KEY';

/** 資料夾的授權：直接授權 ＋ 繼承自上層的（docs/rbac/07-resource-grants.md §6）。 */
export const getFileFolderGrantListQueryOptions = (workspaceId: string, folderId: string) =>
  queryOptions({
    queryKey: [FILE_FOLDER_GRANT_LIST_QUERY_KEY, folderId, workspaceId] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchFileFolderGrantListQuery({
        params: { folderId: queryKey[1], workspaceId: queryKey[2] },
        signal,
      }),
  });
