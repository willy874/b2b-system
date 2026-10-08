import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getApprovalFlowControllerListUrl } from '@/shared/api-sdk';
import type { ApprovalFlowList } from '@/shared/api-sdk';

export const fetchApprovalFlowListQuery = defineAuthFetcher<HttpRequestDTO<void>, ApprovalFlowList>(
  (http) => http.request(getApprovalFlowControllerListUrl(), { method: 'GET' }),
);
