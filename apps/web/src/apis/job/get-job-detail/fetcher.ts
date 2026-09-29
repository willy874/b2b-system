import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getJobControllerFindOneUrl } from '@/shared/api-sdk';
import type { Job } from '@/shared/api-sdk';

export const fetchJobDetailQuery = defineAuthFetcher<HttpRequestDTO<{ id: string }>, Job>(
  (http, request) =>
    http.request(getJobControllerFindOneUrl({ id: request.params.id }), { method: 'GET' }),
);
