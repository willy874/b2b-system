import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
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
