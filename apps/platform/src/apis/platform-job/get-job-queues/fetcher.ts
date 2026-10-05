import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getPlatformJobControllerQueuesUrl } from '@/shared/api-sdk';
import type { PlatformJobQueueList } from '@/shared/api-sdk';

export const fetchPlatformJobQueuesQuery = defineAuthFetcher<
  HttpRequestDTO<void>,
  PlatformJobQueueList
>((http) => http.request(getPlatformJobControllerQueuesUrl(), { method: 'GET' }));
