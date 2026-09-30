import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getPlatformJobControllerFindOneUrl } from '@/shared/api-sdk';
import type { PlatformJob } from '@/shared/api-sdk';

export const fetchPlatformJobQuery = defineAuthFetcher<HttpRequestDTO<{ id: string }>, PlatformJob>(
  (http, request) =>
    http.request(getPlatformJobControllerFindOneUrl({ id: request.params.id }), {
      method: 'GET',
    }),
);
