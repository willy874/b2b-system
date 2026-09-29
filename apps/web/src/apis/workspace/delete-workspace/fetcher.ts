import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getWorkspaceControllerRemoveUrl } from '@/shared/api-sdk';

export const fetchDeleteWorkspaceMutation = defineAuthFetcher<
  HttpRequestDTO<{ workspaceId: string }>,
  undefined
>((http, request) =>
  http.request(getWorkspaceControllerRemoveUrl({ workspaceId: request.params.workspaceId }), {
    method: 'DELETE',
  }),
);
