import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getRoleControllerRestoreUrl } from '@/shared/api-sdk';
import type { RestoredRole } from '@/shared/api-sdk';

export const fetchRoleRestoreMutation = defineAuthFetcher<
  HttpRequestDTO<{ roleId: string }>,
  RestoredRole
>((http, request) =>
  http.request(getRoleControllerRestoreUrl({ id: request.params.roleId }), { method: 'POST' }),
);
