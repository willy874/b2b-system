import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getRoleControllerUpdateUrl } from '@/shared/api-sdk';
import type { Role, UpdateRoleRequest } from '@/shared/api-sdk';

export const fetchRoleUpdateMutation = defineAuthFetcher<
  HttpRequestDTO<{ roleId: string; body: UpdateRoleRequest }>,
  Role
>((http, request) =>
  http.request(
    getRoleControllerUpdateUrl(request.params.roleId),
    jsonBody(request.params.body, { method: 'PATCH' }),
  ),
);
