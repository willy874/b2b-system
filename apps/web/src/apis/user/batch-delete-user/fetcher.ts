import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getUserControllerRemoveManyUrl } from '@/shared/api-sdk';
import type { BatchResult, BatchIdsRequest } from '@/shared/api-sdk';

export const fetchUserBatchDeleteMutation = defineAuthFetcher<
  HttpRequestDTO<{ body: BatchIdsRequest }>,
  BatchResult
>((http, request) =>
  http.request(getUserControllerRemoveManyUrl(), jsonBody(request.params.body, { method: 'POST' })),
);
