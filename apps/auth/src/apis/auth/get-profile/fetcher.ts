import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getAuthControllerProfileUrl } from '@/shared/api-sdk';
import type { Profile } from '@/shared/api-sdk';

export const fetchProfileQuery = defineAuthFetcher<HttpRequestDTO<void>, Profile>((http) =>
  http.request(getAuthControllerProfileUrl(), { method: 'GET' }),
);
