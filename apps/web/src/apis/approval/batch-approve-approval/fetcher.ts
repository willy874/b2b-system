import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getApprovalControllerApproveManyUrl } from '@/shared/api-sdk';
import type { BatchIdsRequest, BatchResult } from '@/shared/api-sdk';

export const fetchBatchApproveApprovalMutation = defineAuthFetcher<
  HttpRequestDTO<{ body: BatchIdsRequest }>,
  BatchResult
>((http, request) =>
  http.request(
    getApprovalControllerApproveManyUrl(),
    jsonBody(request.params.body, { method: 'POST' }),
  ),
);
