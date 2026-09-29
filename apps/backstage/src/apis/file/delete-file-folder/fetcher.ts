import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getFileFolderControllerRemoveUrl } from '@/shared/api-sdk';

import type { InWorkspace } from '../types';

/** 遞迴刪除：子資料夾與其中的檔案一起刪除。 */
export const fetchFileFolderDeleteMutation = defineAuthFetcher<
  HttpRequestDTO<InWorkspace & { folderId: string }>,
  undefined
>((http, request) =>
  http.request(
    getFileFolderControllerRemoveUrl({
      workspaceId: request.params.workspaceId,
      id: request.params.folderId,
    }),
    {
      method: 'DELETE',
    },
  ),
);
