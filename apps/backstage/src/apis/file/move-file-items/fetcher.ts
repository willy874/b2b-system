import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getFileControllerMoveUrl } from '@/shared/api-sdk';
import type { MoveFileItemsRequest, MoveFileItemsResult } from '@/shared/api-sdk';

export const fetchFileMoveMutation = defineAuthFetcher<
  HttpRequestDTO<MoveFileItemsRequest>,
  MoveFileItemsResult
>((http, request) =>
  http.request(getFileControllerMoveUrl(), jsonBody(request.params, { method: 'POST' })),
);
