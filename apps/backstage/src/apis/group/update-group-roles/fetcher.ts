import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getGroupControllerUpdateRolesUrl } from '@/shared/api-sdk';
import type { GroupRoles, UpdateGroupRolesRequest } from '@/shared/api-sdk';

/** PATCH：差異語意（`{ add, remove }`）。super-admin 不能由群組持有（docs/architecture/iam/01-model.md §9.3 D12）。 */
export const fetchGroupRolesUpdateMutation = defineAuthFetcher<
  HttpRequestDTO<{ groupId: string; body: UpdateGroupRolesRequest }>,
  GroupRoles
>((http, request) =>
  http.request(
    getGroupControllerUpdateRolesUrl({ id: request.params.groupId }),
    jsonBody(request.params.body, { method: 'PATCH' }),
  ),
);
