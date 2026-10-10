import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getGroupControllerListMembersUrl } from '@/shared/api-sdk';
import type { GroupControllerListMembersResponse } from '@/shared/api-sdk';

export interface GroupMembersParams {
  groupId: string;
  offset: number;
  limit: number;
  /** 成員的名稱或 email（群組只比對名稱） */
  keyword?: string;
}

export const fetchGroupMembersQuery = defineAuthFetcher<
  HttpRequestDTO<GroupMembersParams>,
  GroupControllerListMembersResponse['data']
>((http, request) =>
  http.request(
    withQuery(getGroupControllerListMembersUrl({ id: request.params.groupId }), {
      offset: request.params.offset,
      limit: request.params.limit,
      keyword: request.params.keyword,
    }),
    { method: 'GET' },
  ),
);
