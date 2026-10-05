import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getRoleControllerListRevisionsUrl } from '@/shared/api-sdk';
import type { RoleControllerListRevisionsResponse } from '@/shared/api-sdk';

export const fetchRoleRevisionsQuery = defineAuthFetcher<
  HttpRequestDTO<{ roleId: string; offset: number; limit: number }>,
  RoleControllerListRevisionsResponse['data']
>((http, request) =>
  http.request(
    withQuery(getRoleControllerListRevisionsUrl({ id: request.params.roleId }), {
      offset: request.params.offset,
      limit: request.params.limit,
    }),
    { method: 'GET' },
  ),
);
