import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getApprovalFlowControllerPreviewUrl } from '@/shared/api-sdk';
import type { ApprovalFlowPreview, PreviewApprovalFlowRequest } from '@/shared/api-sdk';

export const fetchApprovalFlowPreviewMutation = defineAuthFetcher<
  HttpRequestDTO<{ type: string; body: PreviewApprovalFlowRequest }>,
  ApprovalFlowPreview
>((http, request) =>
  http.request(
    getApprovalFlowControllerPreviewUrl({ type: request.params.type }),
    jsonBody(request.params.body, { method: 'POST' }),
  ),
);
