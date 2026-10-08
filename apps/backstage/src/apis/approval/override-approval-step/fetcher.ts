import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getApprovalControllerOverrideUrl } from '@/shared/api-sdk';
import type { ApprovalRequestDetail, OverrideApprovalStepRequest } from '@/shared/api-sdk';

export const fetchApprovalStepOverrideMutation = defineAuthFetcher<
  HttpRequestDTO<{ approvalId: string; ordinal: number; body: OverrideApprovalStepRequest }>,
  ApprovalRequestDetail
>((http, request) =>
  http.request(
    getApprovalControllerOverrideUrl({
      id: request.params.approvalId,
      ordinal: request.params.ordinal,
    }),
    jsonBody(request.params.body, { method: 'POST' }),
  ),
);
