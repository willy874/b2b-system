import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getWorkspaceInvitationControllerRevokeUrl } from '@/shared/api-sdk';

export const fetchRevokeWorkspaceInvitationMutation = defineAuthFetcher<
  HttpRequestDTO<{ workspaceId: string; invitationId: string }>,
  undefined
>((http, request) =>
  http.request(
    getWorkspaceInvitationControllerRevokeUrl({
      workspaceId: request.params.workspaceId,
      invitationId: request.params.invitationId,
    }),
    { method: 'DELETE' },
  ),
);
