import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getApprovalControllerCountsUrl } from '@/shared/api-sdk';
import type { ApprovalCounts } from '@/shared/api-sdk';

export const fetchApprovalCountsQuery = defineAuthFetcher<
  HttpRequestDTO<Record<string, never>>,
  ApprovalCounts
>((http) => http.request(getApprovalControllerCountsUrl(), { method: 'GET' }));
