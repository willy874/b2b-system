import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getRoleControllerRevertToRevisionUrl } from '@/shared/api-sdk';
import type { RevertRoleRevisionRequest, Role } from '@/shared/api-sdk';

export const fetchRoleRevertRevisionMutation = defineAuthFetcher<
  HttpRequestDTO<{ roleId: string; version: number; body: RevertRoleRevisionRequest }>,
  Role
>((http, request) =>
  http.request(
    getRoleControllerRevertToRevisionUrl({
      id: request.params.roleId,
      version: request.params.version,
    }),
    jsonBody(request.params.body, { method: 'POST' }),
  ),
);
