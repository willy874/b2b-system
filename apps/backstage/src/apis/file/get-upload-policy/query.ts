import { queryOptions } from '@tanstack/react-query';

import { fetchFileUploadPolicyQuery } from './fetcher';

export const FILE_UPLOAD_POLICY_QUERY_KEY = 'FILE_UPLOAD_POLICY_QUERY_KEY';

export const FILE_STORAGE_USAGE_QUERY_KEY = 'FILE_STORAGE_USAGE_QUERY_KEY';

/**
 * 上傳的檢查與切法。單檔上限與切法來自後端環境變數與系統設定，一個部署版本內幾乎不變；
 * 容量與已用量（`storageQuota`、`storageUsed`）會變，畫面上的用量改讀 `getFileStorageUsageQueryOptions`。
 */
export const getFileUploadPolicyQueryOptions = () =>
  queryOptions({
    queryKey: [FILE_UPLOAD_POLICY_QUERY_KEY] as const,
    queryFn: ({ signal }) => fetchFileUploadPolicyQuery({ params: undefined, signal }),
    staleTime: Number.POSITIVE_INFINITY,
  });

/**
 * 檔案容量與已用量（docs/adr/0033-feature-params-and-webhook-targets.md D8）：同一支端點，另一個 key，
 * 檔案的增刪由依賴圖（`apis/resources.ts`）讓它重抓。
 */
export const getFileStorageUsageQueryOptions = () =>
  queryOptions({
    queryKey: [FILE_STORAGE_USAGE_QUERY_KEY] as const,
    queryFn: ({ signal }) => fetchFileUploadPolicyQuery({ params: undefined, signal }),
    select: (policy) => ({ quota: policy.storageQuota, used: policy.storageUsed }),
  });
