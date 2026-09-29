import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getWorkspaceInvitationControllerListUrl } from '@/shared/api-sdk';
import type { WorkspaceInvitationList } from '@/shared/api-sdk';

export const fetchWorkspaceInvitationListQuery = defineAuthFetcher<
  HttpRequestDTO<{ workspaceId: string }>,
  WorkspaceInvitationList
>((http, request) =>
  http.request(
    getWorkspaceInvitationControllerListUrl({ workspaceId: request.params.workspaceId }),
    { method: 'GET' },
  ),
);
