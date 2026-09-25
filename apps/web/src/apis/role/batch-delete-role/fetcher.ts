import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getRoleControllerRemoveManyUrl } from '@/shared/api-sdk';
import type { BatchResult, BatchIdsRequest } from '@/shared/api-sdk';

export const fetchRoleBatchDeleteMutation = defineAuthFetcher<
  HttpRequestDTO<{ body: BatchIdsRequest }>,
  BatchResult
>((http, request) =>
  http.request(getRoleControllerRemoveManyUrl(), jsonBody(request.params.body, { method: 'POST' })),
);
