import { queryOptions } from '@tanstack/react-query';

import { fetchFileGrantSubjectListQuery } from './fetcher';
import type { FileGrantSubjectParams } from './fetcher';

export const FILE_GRANT_SUBJECT_LIST_QUERY_KEY = 'FILE_GRANT_SUBJECT_LIST_QUERY_KEY';

/** 授權對象的候選（只有 id 與名稱）；管理授權的人不需要 `role:read` / `user:read`。 */
export const getFileGrantSubjectListQueryOptions = (params: FileGrantSubjectParams) =>
  queryOptions({
    queryKey: [
      FILE_GRANT_SUBJECT_LIST_QUERY_KEY,
      params.folderId,
      params.subjectType,
      params.keyword ?? '',
    ] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchFileGrantSubjectListQuery({
        params: {
          folderId: queryKey[1],
          subjectType: queryKey[2],
          keyword: queryKey[3] || undefined,
        },
        signal,
      }),
  });
