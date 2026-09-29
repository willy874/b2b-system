import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getFileControllerMoveUrl } from '@/shared/api-sdk';
import type { MoveFileItemsRequest, MoveFileItemsResult } from '@/shared/api-sdk';

import type { InWorkspace } from '../types';

export const fetchFileMoveMutation = defineAuthFetcher<
  HttpRequestDTO<InWorkspace & MoveFileItemsRequest>,
  MoveFileItemsResult
>((http, request) => {
  const { workspaceId, ...body } = request.params;
  return http.request(
    getFileControllerMoveUrl({ workspaceId }),
    jsonBody(body, { method: 'POST' }),
  );
});
