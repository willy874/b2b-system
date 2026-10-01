import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getGroupControllerUpdateRolesUrl } from '@/shared/api-sdk';
import type { GroupRoles, UpdateGroupRolesRequest } from '@/shared/api-sdk';

/** PATCH：差異語意（`{ add, remove }`）。super-admin 不能由群組持有（ADR-0024 D12）。 */
export const fetchGroupRolesUpdateMutation = defineAuthFetcher<
  HttpRequestDTO<{ groupId: string; body: UpdateGroupRolesRequest }>,
  GroupRoles
>((http, request) =>
  http.request(
    getGroupControllerUpdateRolesUrl({ id: request.params.groupId }),
    jsonBody(request.params.body, { method: 'PATCH' }),
  ),
);
