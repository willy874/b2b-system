import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getApprovalControllerDecideUrl } from '@/shared/api-sdk';
import type { ApprovalRequestDetail, DecideApprovalStepRequest } from '@/shared/api-sdk';

export const fetchApprovalStepDecideMutation = defineAuthFetcher<
  HttpRequestDTO<{ approvalId: string; ordinal: number; body: DecideApprovalStepRequest }>,
  ApprovalRequestDetail
>((http, request) =>
  http.request(
    getApprovalControllerDecideUrl({
      id: request.params.approvalId,
      ordinal: request.params.ordinal,
    }),
    jsonBody(request.params.body, { method: 'POST' }),
  ),
);
