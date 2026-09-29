import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getWorkspaceControllerFindOneUrl } from '@/shared/api-sdk';
import type { WorkspaceDetail } from '@/shared/api-sdk';

export const fetchWorkspaceDetailQuery = defineAuthFetcher<
  HttpRequestDTO<{ workspaceId: string }>,
  WorkspaceDetail
>((http, request) =>
  http.request(getWorkspaceControllerFindOneUrl({ workspaceId: request.params.workspaceId }), {
    method: 'GET',
  }),
);
