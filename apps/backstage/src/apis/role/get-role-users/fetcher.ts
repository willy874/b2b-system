import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getRoleControllerListUsersUrl } from '@/shared/api-sdk';
import type { RoleControllerListUsersResponse } from '@/shared/api-sdk';

export const fetchRoleUsersQuery = defineAuthFetcher<
  HttpRequestDTO<{ roleId: string; offset: number; limit: number }>,
  RoleControllerListUsersResponse['data']
>((http, request) =>
  http.request(
    withQuery(getRoleControllerListUsersUrl({ id: request.params.roleId }), {
      offset: request.params.offset,
      limit: request.params.limit,
    }),
    { method: 'GET' },
  ),
);
