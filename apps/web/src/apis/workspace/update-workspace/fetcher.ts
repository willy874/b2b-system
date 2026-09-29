import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getWorkspaceControllerUpdateUrl } from '@/shared/api-sdk';
import type { UpdateWorkspaceRequest, WorkspaceDetail } from '@/shared/api-sdk';

export const fetchUpdateWorkspaceMutation = defineAuthFetcher<
  HttpRequestDTO<{ workspaceId: string; body: UpdateWorkspaceRequest }>,
  WorkspaceDetail
>((http, request) =>
  http.request(
    getWorkspaceControllerUpdateUrl({ workspaceId: request.params.workspaceId }),
    jsonBody(request.params.body, { method: 'PATCH' }),
  ),
);
