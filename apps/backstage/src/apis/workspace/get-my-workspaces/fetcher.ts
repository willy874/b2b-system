import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getWorkspaceControllerListMineUrl } from '@/shared/api-sdk';
import type { MyWorkspaceList } from '@/shared/api-sdk';

export const fetchMyWorkspacesQuery = defineAuthFetcher<HttpRequestDTO<void>, MyWorkspaceList>(
  (http) => http.request(getWorkspaceControllerListMineUrl(), { method: 'GET' }),
);
