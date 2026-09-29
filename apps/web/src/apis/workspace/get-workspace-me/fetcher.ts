import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getWorkspaceMemberControllerMeUrl } from '@/shared/api-sdk';
import type { WorkspaceMe } from '@/shared/api-sdk';

export const fetchWorkspaceMeQuery = defineAuthFetcher<
  HttpRequestDTO<{ workspaceId: string }>,
  WorkspaceMe
>((http, request) =>
  http.request(getWorkspaceMemberControllerMeUrl({ workspaceId: request.params.workspaceId }), {
    method: 'GET',
  }),
);
