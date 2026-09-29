import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getWorkspaceInvitationControllerInviteUrl } from '@/shared/api-sdk';
import type { CreateWorkspaceInvitationRequest, WorkspaceInvitation } from '@/shared/api-sdk';

export const fetchCreateWorkspaceInvitationMutation = defineAuthFetcher<
  HttpRequestDTO<CreateWorkspaceInvitationRequest & { workspaceId: string }>,
  WorkspaceInvitation
>((http, { params: { workspaceId, ...body } }) =>
  http.request(
    getWorkspaceInvitationControllerInviteUrl({ workspaceId }),
    jsonBody(body, { method: 'POST' }),
  ),
);
