import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getUserControllerFindOneUrl } from '@/shared/api-sdk';
import type { User } from '@/shared/api-sdk';

export const fetchUserDetailQuery = defineAuthFetcher<HttpRequestDTO<{ userId: string }>, User>(
  (http, request) =>
    http.request(getUserControllerFindOneUrl({ id: request.params.userId }), {
      method: 'GET',
    }),
);
