import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getFileControllerFindOneUrl } from '@/shared/api-sdk';
import type { StoredFile } from '@/shared/api-sdk';

import type { InWorkspace } from '../types';

export const fetchFileDetailQuery = defineAuthFetcher<
  HttpRequestDTO<InWorkspace & { fileId: string }>,
  StoredFile
>((http, request) =>
  http.request(
    getFileControllerFindOneUrl({
      workspaceId: request.params.workspaceId,
      id: request.params.fileId,
    }),
    { method: 'GET' },
  ),
);
