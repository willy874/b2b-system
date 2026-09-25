import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getUserControllerUnlockManyUrl } from '@/shared/api-sdk';
import type { BatchResult, BatchIdsRequest } from '@/shared/api-sdk';

export const fetchUserBatchUnlockMutation = defineAuthFetcher<
  HttpRequestDTO<{ body: BatchIdsRequest }>,
  BatchResult
>((http, request) =>
  http.request(getUserControllerUnlockManyUrl(), jsonBody(request.params.body, { method: 'POST' })),
);
