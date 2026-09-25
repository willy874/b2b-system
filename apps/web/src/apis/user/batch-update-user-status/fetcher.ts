import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getUserControllerUpdateStatusManyUrl } from '@/shared/api-sdk';
import type { BatchResult, BatchUserStatusRequest } from '@/shared/api-sdk';

export const fetchUserBatchStatusMutation = defineAuthFetcher<
  HttpRequestDTO<{ body: BatchUserStatusRequest }>,
  BatchResult
>((http, request) =>
  http.request(
    getUserControllerUpdateStatusManyUrl(),
    jsonBody(request.params.body, { method: 'POST' }),
  ),
);
