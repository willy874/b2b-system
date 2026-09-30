import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getFileFolderControllerRestoreUrl } from '@/shared/api-sdk';
import type { RestoredFileFolder } from '@/shared/api-sdk';

/** 還原資料夾：同一次刪除的子資料夾與檔案一併還原。 */
export const fetchFileFolderRestoreMutation = defineAuthFetcher<
  HttpRequestDTO<{ folderId: string }>,
  RestoredFileFolder
>((http, request) =>
  http.request(getFileFolderControllerRestoreUrl({ id: request.params.folderId }), {
    method: 'POST',
  }),
);
