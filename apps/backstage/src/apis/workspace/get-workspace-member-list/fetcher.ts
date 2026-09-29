import { defineAuthFetcher, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getWorkspaceMemberControllerListMembersUrl } from '@/shared/api-sdk';
import type { WorkspaceMemberControllerListMembersResponse } from '@/shared/api-sdk';
import { toSortParams } from '@/shared/constants';

import type { WorkspaceMemberListParams } from '../types';

export const fetchWorkspaceMemberListQuery = defineAuthFetcher<
  HttpRequestDTO<WorkspaceMemberListParams>,
  WorkspaceMemberControllerListMembersResponse['data']
>((http, request) => {
  const { workspaceId, ...query } = request.params;
  return http.request(
    withQuery(getWorkspaceMemberControllerListMembersUrl({ workspaceId }), {
      ...query,
      sort: query.sort && toSortParams(query.sort),
    }),
    { method: 'GET' },
  );
});
