import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getWorkspaceControllerCreateUrl } from '@/shared/api-sdk';
import type { CreateWorkspaceRequest, WorkspaceDetail } from '@/shared/api-sdk';

export const fetchCreateWorkspaceMutation = defineAuthFetcher<
  HttpRequestDTO<CreateWorkspaceRequest>,
  WorkspaceDetail
>((http, request) =>
  http.request(getWorkspaceControllerCreateUrl(), jsonBody(request.params, { method: 'POST' })),
);
