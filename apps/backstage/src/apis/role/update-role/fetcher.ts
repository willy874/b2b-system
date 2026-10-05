import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getRoleControllerUpdateUrl } from '@/shared/api-sdk';
import type { Role, UpdateRoleRequest } from '@/shared/api-sdk';

export const fetchRoleUpdateMutation = defineAuthFetcher<
  HttpRequestDTO<{ roleId: string; body: UpdateRoleRequest }>,
  Role
>((http, request) =>
  http.request(
    getRoleControllerUpdateUrl({ id: request.params.roleId }),
    jsonBody(request.params.body, { method: 'PATCH' }),
  ),
);
