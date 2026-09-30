import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
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
