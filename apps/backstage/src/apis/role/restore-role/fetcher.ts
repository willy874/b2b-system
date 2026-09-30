import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getRoleControllerRestoreUrl } from '@/shared/api-sdk';
import type { RestoredRole } from '@/shared/api-sdk';

export const fetchRoleRestoreMutation = defineAuthFetcher<
  HttpRequestDTO<{ roleId: string }>,
  RestoredRole
>((http, request) =>
  http.request(getRoleControllerRestoreUrl({ id: request.params.roleId }), { method: 'POST' }),
);
