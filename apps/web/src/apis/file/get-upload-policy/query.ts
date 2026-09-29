import { queryOptions } from '@tanstack/react-query';

import { fetchFileUploadPolicyQuery } from './fetcher';

export const FILE_UPLOAD_POLICY_QUERY_KEY = 'FILE_UPLOAD_POLICY_QUERY_KEY';

/** 來自後端環境變數：一個部署版本內不會變。 */
export const getFileUploadPolicyQueryOptions = (workspaceId: string) =>
  queryOptions({
    queryKey: [FILE_UPLOAD_POLICY_QUERY_KEY, workspaceId] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchFileUploadPolicyQuery({ params: { workspaceId: queryKey[1] }, signal }),
    staleTime: Number.POSITIVE_INFINITY,
  });
