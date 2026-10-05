import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getApprovalControllerApproveUrl } from '@/shared/api-sdk';
import type { ApprovalRequest, ApproveApprovalRequest } from '@/shared/api-sdk';

export const fetchApproveApprovalMutation = defineAuthFetcher<
  HttpRequestDTO<{ approvalId: string; body: ApproveApprovalRequest }>,
  ApprovalRequest
>((http, request) =>
  http.request(
    getApprovalControllerApproveUrl({ id: request.params.approvalId }),
    jsonBody(request.params.body, { method: 'POST' }),
  ),
);
