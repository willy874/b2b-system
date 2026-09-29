import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getWorkspaceControllerAssignAdminUrl } from '@/shared/api-sdk';
import type { WorkspaceDetail } from '@/shared/api-sdk';

export const fetchAssignWorkspaceAdminMutation = defineAuthFetcher<
  HttpRequestDTO<{ workspaceId: string; userId: string }>,
  WorkspaceDetail
>((http, request) =>
  http.request(
    getWorkspaceControllerAssignAdminUrl({ workspaceId: request.params.workspaceId }),
    jsonBody({ userId: request.params.userId }, { method: 'POST' }),
  ),
);
