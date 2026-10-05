import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getUserControllerListRolesUrl } from '@/shared/api-sdk';
import type { UserRoles } from '@/shared/api-sdk';

export const fetchUserRolesQuery = defineAuthFetcher<HttpRequestDTO<{ userId: string }>, UserRoles>(
  (http, request) =>
    http.request(getUserControllerListRolesUrl({ id: request.params.userId }), {
      method: 'GET',
    }),
);
