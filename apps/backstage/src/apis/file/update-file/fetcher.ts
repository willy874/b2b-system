import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getFileControllerUpdateUrl } from '@/shared/api-sdk';
import type { StoredFile, UpdateFileRequest } from '@/shared/api-sdk';

import type { InWorkspace } from '../types';

export const fetchFileUpdateMutation = defineAuthFetcher<
  HttpRequestDTO<InWorkspace & { fileId: string; body: UpdateFileRequest }>,
  StoredFile
>((http, request) =>
  http.request(
    getFileControllerUpdateUrl({
      workspaceId: request.params.workspaceId,
      id: request.params.fileId,
    }),
    jsonBody(request.params.body, { method: 'PATCH' }),
  ),
);
