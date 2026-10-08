import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getApprovalControllerRefreshUrl } from '@/shared/api-sdk';
import type { ApprovalRequestDetail } from '@/shared/api-sdk';

export const fetchApprovalStepRefreshMutation = defineAuthFetcher<
  HttpRequestDTO<{ approvalId: string; ordinal: number }>,
  ApprovalRequestDetail
>((http, request) =>
  http.request(
    getApprovalControllerRefreshUrl({
      id: request.params.approvalId,
      ordinal: request.params.ordinal,
    }),
    { method: 'POST' },
  ),
);
