import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getApprovalControllerRejectManyUrl } from '@/shared/api-sdk';
import type { BatchIdsRequest, BatchResult } from '@/shared/api-sdk';

export const fetchBatchRejectApprovalMutation = defineAuthFetcher<
  HttpRequestDTO<{ body: BatchIdsRequest }>,
  BatchResult
>((http, request) =>
  http.request(
    getApprovalControllerRejectManyUrl(),
    jsonBody(request.params.body, { method: 'POST' }),
  ),
);
