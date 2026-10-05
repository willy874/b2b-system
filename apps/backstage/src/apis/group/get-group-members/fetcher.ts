import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getGroupControllerListMembersUrl } from '@/shared/api-sdk';
import type { GroupControllerListMembersResponse } from '@/shared/api-sdk';

export const fetchGroupMembersQuery = defineAuthFetcher<
  HttpRequestDTO<{ groupId: string; offset: number; limit: number }>,
  GroupControllerListMembersResponse['data']
>((http, request) =>
  http.request(
    withQuery(getGroupControllerListMembersUrl({ id: request.params.groupId }), {
      offset: request.params.offset,
      limit: request.params.limit,
    }),
    { method: 'GET' },
  ),
);
