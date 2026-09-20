import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getAuthControllerProfileUrl } from '@/shared/api-sdk';
import type { Profile } from '@/shared/api-sdk';

export const fetchProfileQuery = defineAuthFetcher<HttpRequestDTO<void> | void, Profile>(
  (http, request) =>
    http.request(getAuthControllerProfileUrl(), {
      method: 'GET',
      signal: (request as HttpRequestDTO<void> | undefined)?.signal,
    }),
);
