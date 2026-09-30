import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getFileControllerMoveUrl } from '@/shared/api-sdk';
import type { MoveFileItemsRequest, MoveFileItemsResult } from '@/shared/api-sdk';

export const fetchFileMoveMutation = defineAuthFetcher<
  HttpRequestDTO<MoveFileItemsRequest>,
  MoveFileItemsResult
>((http, request) =>
  http.request(getFileControllerMoveUrl(), jsonBody(request.params, { method: 'POST' })),
);
