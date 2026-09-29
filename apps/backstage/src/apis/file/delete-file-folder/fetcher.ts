import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getFileFolderControllerRemoveUrl } from '@/shared/api-sdk';

/** 遞迴刪除：子資料夾與其中的檔案一起刪除。 */
export const fetchFileFolderDeleteMutation = defineAuthFetcher<
  HttpRequestDTO<{ folderId: string }>,
  undefined
>((http, request) =>
  http.request(getFileFolderControllerRemoveUrl({ id: request.params.folderId }), {
    method: 'DELETE',
  }),
);
