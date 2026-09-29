import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getJobControllerQueuesUrl } from '@/shared/api-sdk';
import type { JobQueueList } from '@/shared/api-sdk';

export const fetchJobQueueListQuery = defineAuthFetcher<HttpRequestDTO<void>, JobQueueList>(
  (http) => http.request(getJobControllerQueuesUrl(), { method: 'GET' }),
);
