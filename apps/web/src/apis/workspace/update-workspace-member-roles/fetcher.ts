import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getWorkspaceMemberControllerUpdateRolesUrl } from '@/shared/api-sdk';
import type { WorkspaceMemberRoles } from '@/shared/api-sdk';

export const fetchUpdateWorkspaceMemberRolesMutation = defineAuthFetcher<
  HttpRequestDTO<{ workspaceId: string; userId: string; roleIds: string[] }>,
  WorkspaceMemberRoles
>((http, request) =>
  http.request(
    getWorkspaceMemberControllerUpdateRolesUrl({
      workspaceId: request.params.workspaceId,
      userId: request.params.userId,
    }),
    jsonBody({ roleIds: request.params.roleIds }, { method: 'PUT' }),
  ),
);
