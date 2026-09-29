import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getFileControllerRemoveUrl } from '@/shared/api-sdk';

import type { InWorkspace } from '../types';

export const fetchFileDeleteMutation = defineAuthFetcher<
  HttpRequestDTO<InWorkspace & { fileId: string }>,
  undefined
>((http, request) =>
  http.request(
    getFileControllerRemoveUrl({
      workspaceId: request.params.workspaceId,
      id: request.params.fileId,
    }),
    { method: 'DELETE' },
  ),
);
