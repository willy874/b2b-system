import { defineAuthFetcher, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getRoleControllerListUsersUrl } from '@/shared/api-sdk';
import type { RoleControllerListUsers200Data } from '@/shared/api-sdk';

export const fetchRoleUsersQuery = defineAuthFetcher<
  HttpRequestDTO<{ roleId: string; offset: number; limit: number }>,
  RoleControllerListUsers200Data
>((http, request) =>
  http.request(
    withQuery(getRoleControllerListUsersUrl(request.params.roleId), {
      offset: request.params.offset,
      limit: request.params.limit,
    }),
    { method: 'GET', signal: request.signal },
  ),
);
