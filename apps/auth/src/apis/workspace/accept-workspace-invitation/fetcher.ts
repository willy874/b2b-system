import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getWorkspaceInvitationAcceptControllerAcceptUrl } from '@/shared/api-sdk';
import type {
  AcceptedWorkspaceInvitation,
  AcceptWorkspaceInvitationRequest,
} from '@/shared/api-sdk';

export const fetchAcceptWorkspaceInvitationMutation = defineAuthFetcher<
  HttpRequestDTO<AcceptWorkspaceInvitationRequest>,
  AcceptedWorkspaceInvitation
>((http, request) =>
  http.request(
    getWorkspaceInvitationAcceptControllerAcceptUrl(),
    jsonBody(request.params, { method: 'POST' }),
  ),
);
