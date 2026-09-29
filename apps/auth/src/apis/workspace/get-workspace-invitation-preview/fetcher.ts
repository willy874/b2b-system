import { defineBaseFetcher, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getWorkspaceInvitationAcceptControllerPreviewUrl } from '@/shared/api-sdk';
import type { WorkspaceInvitationPreview } from '@/shared/api-sdk';

/** 公開端點：受邀者可能還沒登入（或還沒有帳號）。 */
export const fetchWorkspaceInvitationPreviewQuery = defineBaseFetcher<
  HttpRequestDTO<{ token: string }>,
  WorkspaceInvitationPreview
>((http, request) =>
  http.request(withQuery(getWorkspaceInvitationAcceptControllerPreviewUrl(), request.params), {
    method: 'GET',
  }),
);
