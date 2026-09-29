import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
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
