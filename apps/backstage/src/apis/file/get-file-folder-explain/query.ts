import { queryOptions } from '@tanstack/react-query';

import { fetchFileFolderExplainQuery } from './fetcher';

export const FILE_FOLDER_EXPLAIN_QUERY_KEY = 'FILE_FOLDER_EXPLAIN_QUERY_KEY';

/** 某位使用者在資料夾上每個動作能不能做與路徑（自己，或需要 authz:explain；docs/architecture/iam/01-model.md §9 G4b）。 */
export const getFileFolderExplainQueryOptions = (folderId: string, userId: string) =>
  queryOptions({
    queryKey: [FILE_FOLDER_EXPLAIN_QUERY_KEY, folderId, userId] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchFileFolderExplainQuery({
        params: { folderId: queryKey[1], userId: queryKey[2] },
        signal,
      }),
  });
