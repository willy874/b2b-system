import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getRoleControllerRemoveUrl } from '@/shared/api-sdk';

export const fetchRoleDeleteMutation = defineAuthFetcher<
  HttpRequestDTO<{ roleId: string; force?: boolean }>,
  undefined
>((http, request) =>
  http.request(
    withQuery(getRoleControllerRemoveUrl({ id: request.params.roleId }), {
      force: request.params.force ? 'true' : undefined,
    }),
    { method: 'DELETE' },
  ),
);
