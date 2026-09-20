import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getUserControllerListRolesUrl } from '@/shared/api-sdk';
import type { UserRoles } from '@/shared/api-sdk';

export const fetchUserRolesQuery = defineAuthFetcher<HttpRequestDTO<{ userId: string }>, UserRoles>(
  (http, request) =>
    http.request(getUserControllerListRolesUrl(request.params.userId), {
      method: 'GET',
      signal: request.signal,
    }),
);
