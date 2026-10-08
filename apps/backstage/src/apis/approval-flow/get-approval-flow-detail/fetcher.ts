import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getApprovalFlowControllerGetUrl } from '@/shared/api-sdk';
import type { ApprovalFlow } from '@/shared/api-sdk';

export const fetchApprovalFlowDetailQuery = defineAuthFetcher<
  HttpRequestDTO<{ type: string }>,
  ApprovalFlow
>((http, request) =>
  http.request(getApprovalFlowControllerGetUrl({ type: request.params.type }), { method: 'GET' }),
);
