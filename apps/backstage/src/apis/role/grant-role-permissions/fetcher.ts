import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getRoleControllerUpdatePermissionsUrl } from '@/shared/api-sdk';
import type { RolePermissions, UpdateRolePermissionsRequest } from '@/shared/api-sdk';

/** PATCH：差異語意（`{ add, remove }`），避免兩人同時編輯時互相覆寫。 */
export const fetchGrantRolePermissionsMutation = defineAuthFetcher<
  HttpRequestDTO<{ roleId: string; body: UpdateRolePermissionsRequest }>,
  RolePermissions
>((http, request) =>
  http.request(
    getRoleControllerUpdatePermissionsUrl({ id: request.params.roleId }),
    jsonBody(request.params.body, { method: 'PATCH' }),
  ),
);
