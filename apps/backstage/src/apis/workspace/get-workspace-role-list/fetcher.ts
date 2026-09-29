import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getWorkspaceMemberControllerListRolesUrl } from '@/shared/api-sdk';
import type { WorkspaceRoleList } from '@/shared/api-sdk';

export const fetchWorkspaceRoleListQuery = defineAuthFetcher<
  HttpRequestDTO<{ workspaceId: string }>,
  WorkspaceRoleList
>((http, request) =>
  http.request(
    getWorkspaceMemberControllerListRolesUrl({ workspaceId: request.params.workspaceId }),
    { method: 'GET' },
  ),
);
