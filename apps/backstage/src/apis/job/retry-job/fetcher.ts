import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getJobControllerRetryUrl } from '@/shared/api-sdk';
import type { Job } from '@/shared/api-sdk';

export const fetchRetryJobMutation = defineAuthFetcher<HttpRequestDTO<{ jobId: string }>, Job>(
  (http, request) =>
    http.request(getJobControllerRetryUrl({ id: request.params.jobId }), { method: 'POST' }),
);
