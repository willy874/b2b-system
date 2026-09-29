import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getFileFolderGrantControllerListAccessRequestsUrl } from '@/shared/api-sdk';
import type { FileAccessRequestList } from '@/shared/api-sdk';

import type { InWorkspace } from '../types';

export const fetchFileAccessRequestListQuery = defineAuthFetcher<
  HttpRequestDTO<InWorkspace & { folderId: string }>,
  FileAccessRequestList
>((http, request) =>
  http.request(
    getFileFolderGrantControllerListAccessRequestsUrl({
      workspaceId: request.params.workspaceId,
      id: request.params.folderId,
    }),
    {
      method: 'GET',
    },
  ),
);
