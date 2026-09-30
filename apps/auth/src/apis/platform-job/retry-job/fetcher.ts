import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getPlatformJobControllerRetryUrl } from '@/shared/api-sdk';
import type { PlatformJob } from '@/shared/api-sdk';

/** 只有 `failed` 的工作能重試；其他狀態回 `JOB_NOT_RETRYABLE`。 */
export const fetchRetryPlatformJobMutation = defineAuthFetcher<
  HttpRequestDTO<{ id: string }>,
  PlatformJob
>((http, request) =>
  http.request(getPlatformJobControllerRetryUrl({ id: request.params.id }), { method: 'POST' }),
);
