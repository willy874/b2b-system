import { defineAuthFetcher, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getRoleControllerRemoveUrl } from '@/shared/api-sdk';

export const fetchRoleDeleteMutation = defineAuthFetcher<
  HttpRequestDTO<{ roleId: string; force?: boolean }>,
  undefined
>((http, request) =>
  http.request(
    withQuery(getRoleControllerRemoveUrl(request.params.roleId), {
      force: request.params.force ? 'true' : undefined,
    }),
    { method: 'DELETE' },
  ),
);
