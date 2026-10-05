import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getRoleControllerListPermissionsUrl } from '@/shared/api-sdk';
import type { RolePermissions } from '@/shared/api-sdk';

export const fetchRolePermissionsQuery = defineAuthFetcher<
  HttpRequestDTO<{ roleId: string }>,
  RolePermissions
>((http, request) =>
  http.request(getRoleControllerListPermissionsUrl({ id: request.params.roleId }), {
    method: 'GET',
  }),
);
