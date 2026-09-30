import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getPlatformJobControllerQueuesUrl } from '@/shared/api-sdk';
import type { PlatformJobQueueList } from '@/shared/api-sdk';

export const fetchPlatformJobQueuesQuery = defineAuthFetcher<
  HttpRequestDTO<void>,
  PlatformJobQueueList
>((http) => http.request(getPlatformJobControllerQueuesUrl(), { method: 'GET' }));
