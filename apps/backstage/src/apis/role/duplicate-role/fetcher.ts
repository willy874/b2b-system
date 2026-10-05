import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getRoleControllerDuplicateUrl } from '@/shared/api-sdk';
import type { DuplicateRoleRequest, Role } from '@/shared/api-sdk';

export const fetchRoleDuplicateMutation = defineAuthFetcher<
  HttpRequestDTO<{ roleId: string; body: DuplicateRoleRequest }>,
  Role & { skippedPermissions?: string[] }
>((http, request) =>
  http.request(
    getRoleControllerDuplicateUrl({ id: request.params.roleId }),
    jsonBody(request.params.body, { method: 'POST' }),
  ),
);
