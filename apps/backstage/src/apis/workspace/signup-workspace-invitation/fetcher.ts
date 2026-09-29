import { defineBaseFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getWorkspaceInvitationAcceptControllerSignupUrl } from '@/shared/api-sdk';
import type {
  AcceptedWorkspaceInvitation,
  SignupWorkspaceInvitationRequest,
} from '@/shared/api-sdk';

/** 公開端點：受邀者還沒有帳號。 */
export const fetchSignupWorkspaceInvitationMutation = defineBaseFetcher<
  HttpRequestDTO<SignupWorkspaceInvitationRequest>,
  AcceptedWorkspaceInvitation
>((http, request) =>
  http.request(
    getWorkspaceInvitationAcceptControllerSignupUrl(),
    jsonBody(request.params, { method: 'POST' }),
  ),
);
