import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getFileFolderControllerRenameUrl } from '@/shared/api-sdk';
import type { FileFolder, UpdateFileFolderRequest } from '@/shared/api-sdk';

import type { InWorkspace } from '../types';

export const fetchFileFolderUpdateMutation = defineAuthFetcher<
  HttpRequestDTO<InWorkspace & { folderId: string; body: UpdateFileFolderRequest }>,
  FileFolder
>((http, request) =>
  http.request(
    getFileFolderControllerRenameUrl({
      workspaceId: request.params.workspaceId,
      id: request.params.folderId,
    }),
    jsonBody(request.params.body, { method: 'PATCH' }),
  ),
);
