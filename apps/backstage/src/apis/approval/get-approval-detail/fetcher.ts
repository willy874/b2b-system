import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getApprovalControllerFindOneUrl } from '@/shared/api-sdk';
import type { ApprovalRequest } from '@/shared/api-sdk';

export const fetchApprovalDetailQuery = defineAuthFetcher<
  HttpRequestDTO<{ approvalId: string }>,
  ApprovalRequest
>((http, request) =>
  http.request(getApprovalControllerFindOneUrl({ id: request.params.approvalId }), {
    method: 'GET',
  }),
);
