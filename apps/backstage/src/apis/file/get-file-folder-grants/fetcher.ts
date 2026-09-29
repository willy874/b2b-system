import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getFileFolderGrantControllerListUrl } from '@/shared/api-sdk';
import type { FileFolderGrantList } from '@/shared/api-sdk';

import type { InWorkspace } from '../types';

export const fetchFileFolderGrantListQuery = defineAuthFetcher<
  HttpRequestDTO<InWorkspace & { folderId: string }>,
  FileFolderGrantList
>((http, request) =>
  http.request(
    getFileFolderGrantControllerListUrl({
      workspaceId: request.params.workspaceId,
      id: request.params.folderId,
    }),
    {
      method: 'GET',
    },
  ),
);
