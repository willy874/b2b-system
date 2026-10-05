import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getRoleControllerGetRevisionUrl } from '@/shared/api-sdk';
import type { RoleRevision } from '@/shared/api-sdk';

export const fetchRoleRevisionQuery = defineAuthFetcher<
  HttpRequestDTO<{ roleId: string; version: number }>,
  RoleRevision
>((http, request) =>
  http.request(
    getRoleControllerGetRevisionUrl({ id: request.params.roleId, version: request.params.version }),
    { method: 'GET' },
  ),
);
