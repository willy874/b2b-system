import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getApprovalFlowControllerStatsUrl } from '@/shared/api-sdk';
import type { ApprovalFlowStats } from '@/shared/api-sdk';

export const fetchApprovalFlowStatsQuery = defineAuthFetcher<
  HttpRequestDTO<{ type: string }>,
  ApprovalFlowStats
>((http, request) =>
  http.request(getApprovalFlowControllerStatsUrl({ type: request.params.type }), {
    method: 'GET',
  }),
);
