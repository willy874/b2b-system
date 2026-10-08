import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getApprovalFlowControllerPutUrl } from '@/shared/api-sdk';
import type { ApprovalFlow, PutApprovalFlowRequest } from '@/shared/api-sdk';

export const fetchApprovalFlowPutMutation = defineAuthFetcher<
  HttpRequestDTO<{ type: string; body: PutApprovalFlowRequest }>,
  ApprovalFlow
>((http, request) =>
  http.request(
    getApprovalFlowControllerPutUrl({ type: request.params.type }),
    jsonBody(request.params.body, { method: 'PUT' }),
  ),
);
