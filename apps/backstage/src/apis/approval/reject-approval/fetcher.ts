import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getApprovalControllerRejectUrl } from '@/shared/api-sdk';
import type { ApprovalRequest, RejectApprovalRequest } from '@/shared/api-sdk';

export const fetchRejectApprovalMutation = defineAuthFetcher<
  HttpRequestDTO<{ approvalId: string; body: RejectApprovalRequest }>,
  ApprovalRequest
>((http, request) =>
  http.request(
    getApprovalControllerRejectUrl({ id: request.params.approvalId }),
    jsonBody(request.params.body, { method: 'POST' }),
  ),
);
