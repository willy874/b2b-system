import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getApprovalFlowControllerResetUrl } from '@/shared/api-sdk';

/** 重設流程（回到單關審批）：帶開始時看到的版本，別人改過時 409。 */
export const fetchApprovalFlowResetMutation = defineAuthFetcher<
  HttpRequestDTO<{ type: string; version: number }>,
  undefined
>((http, request) =>
  http.request(
    withQuery(getApprovalFlowControllerResetUrl({ type: request.params.type }), {
      version: request.params.version,
    }),
    { method: 'DELETE' },
  ),
);
