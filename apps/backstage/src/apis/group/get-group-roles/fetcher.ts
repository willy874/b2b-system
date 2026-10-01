import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getGroupControllerListRolesUrl } from '@/shared/api-sdk';
import type { GroupRoles } from '@/shared/api-sdk';

export const fetchGroupRolesQuery = defineAuthFetcher<
  HttpRequestDTO<{ groupId: string }>,
  GroupRoles
>((http, request) =>
  http.request(getGroupControllerListRolesUrl({ id: request.params.groupId }), { method: 'GET' }),
);
