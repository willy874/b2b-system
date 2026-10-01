import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getGroupControllerUpdateMembersUrl } from '@/shared/api-sdk';
import type { Group, UpdateGroupMembersRequest } from '@/shared/api-sdk';

/** PATCH：差異語意（`{ add, remove }`），避免兩人同時編輯時互相覆寫。 */
export const fetchGroupMembersUpdateMutation = defineAuthFetcher<
  HttpRequestDTO<{ groupId: string; body: UpdateGroupMembersRequest }>,
  Group
>((http, request) =>
  http.request(
    getGroupControllerUpdateMembersUrl({ id: request.params.groupId }),
    jsonBody(request.params.body, { method: 'PATCH' }),
  ),
);
