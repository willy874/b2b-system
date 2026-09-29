import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getWorkspaceMemberControllerRemoveMemberUrl } from '@/shared/api-sdk';

export const fetchDeleteWorkspaceMemberMutation = defineAuthFetcher<
  HttpRequestDTO<{ workspaceId: string; userId: string }>,
  undefined
>((http, request) =>
  http.request(
    getWorkspaceMemberControllerRemoveMemberUrl({
      workspaceId: request.params.workspaceId,
      userId: request.params.userId,
    }),
    { method: 'DELETE' },
  ),
);
