import { queryOptions } from '@tanstack/react-query';

import { fetchFileAccessRequestListQuery } from './fetcher';

export const FILE_ACCESS_REQUEST_LIST_QUERY_KEY = 'FILE_ACCESS_REQUEST_LIST_QUERY_KEY';

/** 資料夾的待審存取申請（需要能管理它的授權，docs/architecture/iam/06-resource-grants.md §6.5）。 */
export const getFileAccessRequestListQueryOptions = (folderId: string) =>
  queryOptions({
    queryKey: [FILE_ACCESS_REQUEST_LIST_QUERY_KEY, folderId] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchFileAccessRequestListQuery({ params: { folderId: queryKey[1] }, signal }),
  });
