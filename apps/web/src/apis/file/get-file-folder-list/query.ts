import { queryOptions } from '@tanstack/react-query';

import { fetchFileFolderListQuery } from './fetcher';

export const FILE_FOLDER_LIST_QUERY_KEY = 'FILE_FOLDER_LIST_QUERY_KEY';

/**
 * 全部的資料夾（扁平清單）。樹狀面板、麵包屑、主區塊的資料夾、移動對話框共用這一份，
 * 資料夾數量不多，一次拿齊比逐層展開時各自查詢簡單（docs/architecture/frontend/12-file-manager.md §12）。
 */
export const getFileFolderListQueryOptions = (workspaceId: string) =>
  queryOptions({
    queryKey: [FILE_FOLDER_LIST_QUERY_KEY, workspaceId] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchFileFolderListQuery({ params: { workspaceId: queryKey[1] }, signal }),
  });
