import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getApprovalControllerWithdrawUrl } from '@/shared/api-sdk';
import type { ApprovalRequestDetail } from '@/shared/api-sdk';

export const fetchApprovalWithdrawMutation = defineAuthFetcher<
  HttpRequestDTO<{ approvalId: string }>,
  ApprovalRequestDetail
>((http, request) =>
  http.request(getApprovalControllerWithdrawUrl({ id: request.params.approvalId }), {
    method: 'POST',
  }),
);
