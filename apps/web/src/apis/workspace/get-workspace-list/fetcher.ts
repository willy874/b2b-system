import { defineAuthFetcher, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getWorkspaceControllerListUrl } from '@/shared/api-sdk';
import type { WorkspaceControllerListResponse } from '@/shared/api-sdk';
import { toSortParams } from '@/shared/constants';

import type { WorkspaceListParams } from '../types';

export const fetchWorkspaceListQuery = defineAuthFetcher<
  HttpRequestDTO<WorkspaceListParams>,
  WorkspaceControllerListResponse['data']
>((http, request) =>
  http.request(
    withQuery(getWorkspaceControllerListUrl(), {
      ...request.params,
      sort: request.params.sort && toSortParams(request.params.sort),
    }),
    { method: 'GET' },
  ),
);
