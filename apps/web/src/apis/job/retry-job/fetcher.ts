import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getJobControllerRetryUrl } from '@/shared/api-sdk';
import type { Job } from '@/shared/api-sdk';

export const fetchRetryJobMutation = defineAuthFetcher<HttpRequestDTO<{ jobId: string }>, Job>(
  (http, request) =>
    http.request(getJobControllerRetryUrl({ id: request.params.jobId }), { method: 'POST' }),
);
